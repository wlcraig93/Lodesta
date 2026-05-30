import type { SiteBundle } from "./models";
import { ipHashForRequest } from "./privacy";
import { repository } from "./repository";

export async function recordAgentReadableRequest(input: {
  bundle: SiteBundle;
  request: Request;
  resource: "llms_txt" | "markdown_alternate";
  pageId?: string;
}) {
  const observedAt = new Date();
  const ipHash = ipHashForRequest(input.request, {
    siteId: input.bundle.businessProfile.siteId,
    at: observedAt
  });

  try {
    await repository.recordAnalyticsEvent({
      siteId: input.bundle.businessProfile.siteId,
      sessionId: `agent:${ipHash ?? crypto.randomUUID()}`,
      pageId: input.pageId,
      eventType: "agent_readable_request",
      timestamp: observedAt.toISOString(),
      metadata: {
        resource: input.resource,
        path: new URL(input.request.url).pathname,
        acceptMarkdown: acceptsMarkdown(input.request.headers),
        agentFamily: agentFamily(input.request.headers.get("user-agent")),
        verifiedBot: verifiedBot(input.request.headers)
      }
    });
  } catch {
    // Analytics must not block agent-readable public artifacts.
  }
}

function acceptsMarkdown(headers: Headers) {
  return (headers.get("accept") ?? "").toLowerCase().includes("text/markdown");
}

function verifiedBot(headers: Headers) {
  const value = headers.get("cf-verified-bot") ?? headers.get("x-verified-bot");
  return value === "1" || value?.toLowerCase() === "true";
}

function agentFamily(userAgent: string | null) {
  const value = userAgent?.toLowerCase() ?? "";
  if (!value) return "unknown";
  if (value.includes("gptbot")) return "gptbot";
  if (value.includes("oai-searchbot")) return "oai-searchbot";
  if (value.includes("chatgpt-user")) return "chatgpt-user";
  if (value.includes("claudebot") || value.includes("anthropic")) return "claude";
  if (value.includes("perplexity")) return "perplexity";
  if (value.includes("googlebot")) return "googlebot";
  if (value.includes("bingbot")) return "bingbot";
  if (value.includes("ccbot")) return "ccbot";
  if (value.includes("bot") || value.includes("crawler") || value.includes("spider")) return "other_bot";
  return "browser_or_tool";
}
