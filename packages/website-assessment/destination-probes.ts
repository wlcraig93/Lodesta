import type { CrawlAssessment, CrawlLinkReference } from "@/lib/crawler";
import { assertPublicFetchUrl } from "@/lib/url-safety";
import {
  generationCrawlerUserAgent,
  parseRobotsPolicy,
  robotsAllows,
  type RobotsRule
} from "@/packages/business-data/robots-policy";

export type DestinationProbe = {
  url: string;
  finalUrl?: string;
  kind: "internal" | "primary_external";
  ok: boolean;
  status?: number;
  method: "HEAD" | "GET";
  error?: string;
  observedAt: string;
};

export type DestinationProbeResult = {
  probes: DestinationProbe[];
  discoveredInternal: number;
  probedInternal: number;
  discoveredPrimaryExternal: number;
  probedPrimaryExternal: number;
  limitations: string[];
};

const internalProbeLimit = 250;
const externalProbeLimit = 10;
const concurrency = 2;
const spacingMs = 500;

export async function probeCrawlDestinations(input: {
  crawl: CrawlAssessment;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<DestinationProbeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const source = new URL(input.crawl.finalUrl ?? input.crawl.url);
  const links = uniqueLinks(input.crawl.pageSummaries.flatMap((page) => page.linkReferences));
  const internal = links
    .filter((link) => link.kind === "internal" && sameSite(new URL(link.href).hostname, source.hostname))
    .slice(0, internalProbeLimit);
  const primaryExternal = links
    .filter((link) => ["booking", "ordering"].includes(link.kind) && !sameSite(new URL(link.href).hostname, source.hostname))
    .slice(0, externalProbeLimit);
  const scheduler = new PerOriginScheduler(spacingMs);
  const robotsRules = await scheduler.run(source.href, () => readRobots(source, fetchImpl, input.signal));
  const targets = [
    ...internal.filter((link) => robotsAllows(link.href, robotsRules)).map((link) => ({ link, kind: "internal" as const })),
    ...primaryExternal.map((link) => ({ link, kind: "primary_external" as const }))
  ];
  const probes: DestinationProbe[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const target = targets[cursor++];
      if (input.signal?.aborted) throw input.signal.reason;
      probes.push(await scheduler.run(target.link.href, () => probeOne(target.link.href, target.kind, fetchImpl, input.signal)));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const disallowed = internal.length - targets.filter((target) => target.kind === "internal").length;
  const limitations = [
    internal.length < uniqueLinks(links.filter((link) => link.kind === "internal")).length
      ? `Internal destination probing was capped at ${internalProbeLimit} URLs.`
      : undefined,
    disallowed ? `${disallowed} internal destination${disallowed === 1 ? "" : "s"} were not probed because robots.txt disallowed them.` : undefined,
    primaryExternal.length
      ? "Only primary external booking and ordering destinations were probed; third-party forms were never submitted."
      : "No primary external booking or ordering destination was detected."
  ].filter((value): value is string => Boolean(value));
  return {
    probes,
    discoveredInternal: links.filter((link) => link.kind === "internal").length,
    probedInternal: probes.filter((probe) => probe.kind === "internal").length,
    discoveredPrimaryExternal: links.filter((link) => ["booking", "ordering"].includes(link.kind)).length,
    probedPrimaryExternal: probes.filter((probe) => probe.kind === "primary_external").length,
    limitations
  };
}

async function probeOne(
  rawUrl: string,
  kind: DestinationProbe["kind"],
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<DestinationProbe> {
  const observedAt = new Date().toISOString();
  try {
    const head = await safeRequest(rawUrl, "HEAD", fetchImpl, signal);
    const response = head.status === 405 || head.status === 501
      ? await safeRequest(rawUrl, "GET", fetchImpl, signal)
      : head;
    return {
      url: rawUrl,
      finalUrl: response.url,
      kind,
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      method: response.method,
      observedAt
    };
  } catch (error) {
    return {
      url: rawUrl,
      kind,
      ok: false,
      method: "HEAD",
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      observedAt
    };
  }
}

async function safeRequest(
  rawUrl: string,
  method: "HEAD" | "GET",
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<{ status: number; url: string; method: "HEAD" | "GET" }> {
  let url = await assertPublicFetchUrl(rawUrl);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000);
    let response = await fetchImpl(url, requestInit(method, requestSignal));
    if ([429, 503].includes(response.status)) {
      const retryDelay = retryAfterMs(response.headers.get("retry-after"));
      if (retryDelay !== undefined) {
        await response.body?.cancel().catch(() => undefined);
        await delay(retryDelay);
        const retrySignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000);
        response = await fetchImpl(url, requestInit(method, retrySignal));
      }
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (redirect === 5) throw new Error("Destination exceeded the redirect limit.");
      await response.body?.cancel().catch(() => undefined);
      url = await assertPublicFetchUrl(new URL(response.headers.get("location")!, url).href);
      continue;
    }
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status, url, method };
  }
  throw new Error("Destination exceeded the redirect limit.");
}

async function readRobots(source: URL, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<RobotsRule[]> {
  try {
    let robotsUrl = await assertPublicFetchUrl(new URL("/robots.txt", source).href);
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      const response = await fetchImpl(robotsUrl, {
        redirect: "manual",
        headers: { "User-Agent": generationCrawlerUserAgent, Accept: "text/plain,*/*;q=0.1" },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => undefined);
        if (redirect === 5) return [];
        robotsUrl = await assertPublicFetchUrl(new URL(location, robotsUrl).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return [];
      }
      return parseRobotsPolicy(await response.text()).rules;
    }
    return [];
  } catch {
    return [];
  }
}

function requestInit(method: "HEAD" | "GET", signal: AbortSignal): RequestInit {
  return {
    method,
    redirect: "manual",
    headers: {
      "User-Agent": generationCrawlerUserAgent,
      Accept: method === "GET" ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" : "*/*"
    },
    signal
  };
}

class PerOriginScheduler {
  private next = new Map<string, number>();
  private locks = new Map<string, Promise<void>>();
  constructor(private readonly spacing: number) {}

  async run<T>(rawUrl: string, operation: () => Promise<T>) {
    const origin = new URL(rawUrl).origin;
    const prior = this.locks.get(origin) ?? Promise.resolve();
    let release: () => void = () => {};
    const lock = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(origin, prior.then(() => lock));
    await prior;
    const wait = Math.max(0, (this.next.get(origin) ?? 0) - Date.now());
    if (wait) await delay(wait);
    this.next.set(origin, Date.now() + this.spacing);
    release();
    return operation();
  }
}

function uniqueLinks(links: CrawlLinkReference[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    try {
      const url = new URL(link.href);
      url.hash = "";
      const key = url.href;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      return false;
    }
  });
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
