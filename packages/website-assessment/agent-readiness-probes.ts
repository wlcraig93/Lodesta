import { assertPublicFetchUrl } from "@/lib/url-safety";
import {
  generationCrawlerUserAgent,
  parseRobotsPolicy,
  robotsAllows
} from "@/packages/business-data/robots-policy";
import type { GenerationCrawlTechnicalEvidence } from "@/packages/business-data/generation-crawler";

export type AgentReadinessProbeId =
  | "robots_txt"
  | "html_home"
  | "markdown_home"
  | "llms_txt"
  | "web_bot_auth"
  | "agent_skills"
  | "api_catalog"
  | "oauth_authorization_server"
  | "oauth_protected_resource"
  | "mcp_server_card"
  | "ucp"
  | "acp";

export type AgentReadinessProbeObservation = {
  id: AgentReadinessProbeId;
  url: string;
  finalUrl?: string;
  status?: number;
  ok: boolean;
  contentType?: string;
  linkHeader?: string;
  body?: string;
  error?: string;
  skipped?: "robots_disallowed";
  observedAt: string;
};

export type AgentReadinessProbeResult = {
  probes: AgentReadinessProbeObservation[];
  robots: {
    found: boolean;
    aiAgents: string[];
    blockedAiAgents: string[];
    contentSignals?: {
      search?: "yes" | "no";
      aiInput?: "yes" | "no";
      aiTrain?: "yes" | "no";
    };
  };
  capabilities: {
    api: boolean;
    oauth: boolean;
    mcp: boolean;
    agent: boolean;
    webMcp: boolean;
    x402: boolean;
  };
  limitations: string[];
};

const maximumProbes = 12;
const maximumBodyBytes = 64 * 1024;
const requestTimeoutMs = 10_000;
const spacingMs = 500;

const targets: ReadonlyArray<{
  id: AgentReadinessProbeId;
  path: string;
  accept: string;
}> = [
  { id: "robots_txt", path: "/robots.txt", accept: "text/plain,*/*;q=0.1" },
  { id: "html_home", path: "", accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
  { id: "markdown_home", path: "", accept: "text/markdown,*/*;q=0.1" },
  { id: "llms_txt", path: "/llms.txt", accept: "text/plain,text/markdown;q=0.9,*/*;q=0.1" },
  { id: "web_bot_auth", path: "/.well-known/http-message-signatures-directory", accept: "application/json,*/*;q=0.1" },
  { id: "agent_skills", path: "/.well-known/agent-skills/index.json", accept: "application/json,*/*;q=0.1" },
  { id: "api_catalog", path: "/.well-known/api-catalog", accept: "application/json,*/*;q=0.1" },
  { id: "oauth_authorization_server", path: "/.well-known/oauth-authorization-server", accept: "application/json,*/*;q=0.1" },
  { id: "oauth_protected_resource", path: "/.well-known/oauth-protected-resource", accept: "application/json,*/*;q=0.1" },
  { id: "mcp_server_card", path: "/.well-known/mcp/server-card.json", accept: "application/json,*/*;q=0.1" },
  { id: "ucp", path: "/.well-known/ucp", accept: "application/json,*/*;q=0.1" },
  { id: "acp", path: "/.well-known/acp", accept: "application/json,*/*;q=0.1" }
] as const;

export async function collectAgentReadinessProbes(input: {
  url: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  existingEvidence?: GenerationCrawlTechnicalEvidence;
}): Promise<AgentReadinessProbeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = new URL(await assertPublicFetchUrl(input.url));
  const seededAt = new Date().toISOString();
  const probes: AgentReadinessProbeObservation[] = [];
  if (input.existingEvidence?.robots) {
    probes.push({
      id: "robots_txt",
      url: input.existingEvidence.robots.url,
      finalUrl: input.existingEvidence.robots.url,
      status: input.existingEvidence.robots.found ? 200 : 404,
      ok: input.existingEvidence.robots.found,
      contentType: input.existingEvidence.robots.found ? "text/plain" : undefined,
      body: input.existingEvidence.robots.body,
      observedAt: seededAt
    });
  }
  if (input.existingEvidence?.homepage) {
    probes.push({
      id: "html_home",
      url: input.existingEvidence.homepage.url,
      finalUrl: input.existingEvidence.homepage.finalUrl,
      status: input.existingEvidence.homepage.status,
      ok: input.existingEvidence.homepage.status >= 200 && input.existingEvidence.homepage.status < 300,
      contentType: input.existingEvidence.homepage.contentType,
      linkHeader: input.existingEvidence.homepage.linkHeader,
      body: input.existingEvidence.homepage.body,
      observedAt: seededAt
    });
  }
  let robotsRules: ReturnType<typeof parseRobotsPolicy>["rules"] = [];
  const seededRobots = findProbe(probes, "robots_txt");
  if (seededRobots?.ok && seededRobots.body) robotsRules = parseRobotsPolicy(seededRobots.body).rules;
  let lastStartAt = 0;
  const requestSpacing = input.fetchImpl ? 0 : spacingMs;
  const scheduledFetch = (async (request: RequestInfo | URL, init?: RequestInit) => {
    const wait = Math.max(0, lastStartAt + requestSpacing - Date.now());
    if (wait) await delay(wait);
    lastStartAt = Date.now();
    return fetchImpl(request, init);
  }) as typeof fetch;

  for (const target of targets.slice(0, maximumProbes)) {
    if (findProbe(probes, target.id)) continue;
    const targetUrl = target.path ? new URL(target.path, base).href : base.href;
    if (target.id !== "robots_txt" && !robotsAllows(targetUrl, robotsRules)) {
      probes.push({
        id: target.id,
        url: targetUrl,
        ok: false,
        skipped: "robots_disallowed",
        error: "robots.txt disallowed this readiness probe.",
        observedAt: new Date().toISOString()
      });
      continue;
    }
    const observation = await probe({
      id: target.id,
      url: targetUrl,
      accept: target.accept,
      base,
      fetchImpl: scheduledFetch,
      signal: input.signal
    });
    probes.push(observation);
    if (target.id === "robots_txt" && observation.ok && observation.body) {
      robotsRules = parseRobotsPolicy(observation.body).rules;
    }
  }

  const robotsObservation = findProbe(probes, "robots_txt");
  const html = findProbe(probes, "html_home")?.body ?? "";
  const allHeadersAndBodies = probes.filter((probe) => probe.ok)
    .map((probe) => `${probe.linkHeader ?? ""}\n${probe.body ?? ""}`)
    .join("\n");
  return {
    probes,
    robots: analyzeRobots(robotsObservation?.body),
    capabilities: {
      api: /\b(openapi|swagger|api[- _]?catalog|\/api\/|developer api)\b/i.test(`${html}\n${allHeadersAndBodies}`),
      oauth: /\b(oauth|authorization_server|oauth-protected-resource)\b/i.test(`${html}\n${allHeadersAndBodies}`),
      mcp: /\b(model context protocol|mcp[- _]?server|\/mcp\b)\b/i.test(`${html}\n${allHeadersAndBodies}`),
      agent: /\b(agent[- _]?skills?|ai agent|agentic|mcp)\b/i.test(`${html}\n${allHeadersAndBodies}`),
      webMcp: /\b(navigator\.modelContext|registerTool|webmcp)\b/i.test(html),
      x402: /\b(x402|payment-required|payment_required)\b/i.test(allHeadersAndBodies)
    },
    limitations: [
      "Agent access was inferred from declared first-party policy; CDN or WAF bot enforcement was not tested by impersonating third-party crawlers.",
      probes.some((probe) => probe.skipped === "robots_disallowed")
        ? "Some Agent Readiness resources were not requested because robots.txt disallowed the probe."
        : undefined,
      probes.some((probe) => probe.error && !probe.skipped)
        ? "One or more bounded Agent Readiness probes failed or timed out."
        : undefined
    ].filter((value): value is string => Boolean(value))
  };
}

export function findProbe(
  result: AgentReadinessProbeResult | AgentReadinessProbeObservation[],
  id: AgentReadinessProbeId
) {
  const probes = Array.isArray(result) ? result : result.probes;
  return probes.find((probe) => probe.id === id);
}

export function validJsonProbe(observation: AgentReadinessProbeObservation | undefined) {
  if (!observation?.ok || !observation.body?.trim()) return false;
  if (!observation.contentType?.toLowerCase().includes("json")) return false;
  try {
    const parsed = JSON.parse(observation.body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !boundedJson(parsed)) return false;
    const document = parsed as Record<string, unknown>;
    switch (observation.id) {
      case "web_bot_auth":
        return nonEmptyArray(document.keys)
          || nonEmptyRecord(document.keys)
          || nonEmptyArray(document.public_keys)
          || nonEmptyRecord(document.public_keys)
          || typeof document.jwks_uri === "string";
      case "agent_skills":
        return nonEmptyArray(document.skills);
      case "api_catalog":
        return nonEmptyArray(document.linkset) || nonEmptyArray(document.apis);
      case "oauth_authorization_server":
        return typeof document.issuer === "string"
          && (typeof document.authorization_endpoint === "string" || typeof document.token_endpoint === "string");
      case "oauth_protected_resource":
        return typeof document.resource === "string" && nonEmptyArray(document.authorization_servers);
      case "mcp_server_card":
        return isRecord(document.serverInfo) && isRecord(document.transport);
      case "ucp":
        return typeof document.version === "string"
          && (nonEmptyArray(document.services) || nonEmptyArray(document.capabilities) || isRecord(document.endpoints));
      case "acp":
        return typeof document.version === "string"
          && (nonEmptyArray(document.capabilities) || typeof document.endpoint === "string" || isRecord(document.merchant));
      default:
        return true;
    }
  } catch {
    return false;
  }
}

function boundedJson(value: unknown, depth = 0, state = { nodes: 0 }): boolean {
  state.nodes += 1;
  if (state.nodes > 500 || depth > 8) return false;
  if (typeof value === "string") return value.length <= 8_000;
  if (value === null || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => boundedJson(item, depth + 1, state));
  if (!isRecord(value) || Object.keys(value).length > 100) return false;
  return Object.entries(value).every(([key, item]) => key.length <= 200 && boundedJson(item, depth + 1, state));
}

function nonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function nonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function probe(input: {
  id: AgentReadinessProbeId;
  url: string;
  accept: string;
  base: URL;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}): Promise<AgentReadinessProbeObservation> {
  const observedAt = new Date().toISOString();
  try {
    let url = await assertPublicFetchUrl(input.url);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const response = await requestWithRetry(url, input.accept, input.fetchImpl, input.signal);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => undefined);
        if (redirects === 5) throw new Error("Agent Readiness resource exceeded the redirect limit.");
        const next = new URL(await assertPublicFetchUrl(new URL(location, url).href));
        if (!sameSite(next.hostname, input.base.hostname)) {
          throw new Error("Agent Readiness resource redirected away from the assessed site.");
        }
        url = next.href;
        continue;
      }
      const body = await readBoundedBody(response);
      return {
        id: input.id,
        url: input.url,
        finalUrl: url,
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get("content-type") ?? undefined,
        linkHeader: response.headers.get("link") ?? undefined,
        body,
        observedAt
      };
    }
    throw new Error("Agent Readiness resource exceeded the redirect limit.");
  } catch (error) {
    return {
      id: input.id,
      url: input.url,
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      observedAt
    };
  }
}

async function requestWithRetry(
  url: string,
  accept: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
) {
  let response = await fetchImpl(url, requestInit(accept, signal));
  if (response.status !== 429 && response.status !== 503) return response;
  const wait = retryAfterMs(response.headers.get("retry-after"));
  if (wait === undefined) return response;
  await response.body?.cancel().catch(() => undefined);
  await delay(wait);
  response = await fetchImpl(url, requestInit(accept, signal));
  return response;
}

function requestInit(accept: string, signal?: AbortSignal): RequestInit {
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  return {
    redirect: "manual",
    headers: {
      "User-Agent": generationCrawlerUserAgent,
      Accept: accept
    },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  };
}

async function readBoundedBody(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBodyBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Agent Readiness response exceeded ${maximumBodyBytes} bytes.`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBodyBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Agent Readiness response exceeded ${maximumBodyBytes} bytes.`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function analyzeRobots(text: string | undefined): AgentReadinessProbeResult["robots"] {
  if (!text) return { found: false, aiAgents: [], blockedAiAgents: [] };
  const aiAgents = [...new Set(
    [...text.matchAll(/^\s*user-agent\s*:\s*([^\s#]+)\s*$/gim)]
      .map((match) => match[1])
      .filter((agent) => /(gpt|openai|oai-search|chatgpt|claude|anthropic|perplexity|cohere|google-extended|bytespider|ccbot|amazonbot|applebot)/i.test(agent))
  )];
  const blockedAiAgents = aiAgents.filter((agent) =>
    !robotsAllows("https://agent-readiness.invalid/", parseRobotsPolicy(text, agent).rules)
  );
  const signal = [...text.matchAll(/^\s*content-signal\s*:\s*([^\r\n#]+)/gim)]
    .map((match) => match[1])
    .join(",");
  const value = (name: string) => signal.match(new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*(yes|no)`, "i"))?.[1]?.toLowerCase() as "yes" | "no" | undefined;
  const contentSignals = {
    search: value("search"),
    aiInput: value("ai-input"),
    aiTrain: value("ai-train")
  };
  return {
    found: true,
    aiAgents,
    blockedAiAgents,
    contentSignals: Object.values(contentSignals).some(Boolean) ? contentSignals : undefined
  };
}

function sameSite(left: string, right: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/^www\./, "");
  return normalize(left) === normalize(right);
}

function retryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(5_000, Math.max(0, seconds * 1_000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(5_000, Math.max(0, date - Date.now())) : undefined;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
