import type { SourceSnapshotResource } from "@/packages/site-contracts";
import { crawlWebsiteForGeneration } from "./generation-crawler";

export type RetainedReplayResource = {
  resource: SourceSnapshotResource;
  /** Decoded raw response body (see decodeRetainedSourceResource), when retained. */
  body?: Buffer;
};

/**
 * A crawl transport that answers only from a retained website source mirror,
 * so fact extraction can be re-derived from exactly what was captured without
 * touching the network. Anything the mirror did not retain answers 404, and
 * browser rendering returns the retained rendered DOM or fails.
 */
export function retainedWebsiteReplayTransport(resources: RetainedReplayResource[]): NonNullable<
  Pick<Parameters<typeof crawlWebsiteForGeneration>[0], "fetchImpl" | "browserFetch" | "validateUrl" | "sleep">
> {
  const responses = new Map<string, () => Response>();
  const rendered = new Map<string, string>();
  for (const { resource, body } of resources) {
    if (resource.role === "rendered_document") {
      if (resource.outcome === "fetched" && body) rendered.set(resource.requestedUrl, body.toString("utf8"));
      continue;
    }
    for (const hop of resource.redirectChain) {
      if (!responses.has(hop.url)) {
        responses.set(hop.url, () => new Response(null, { status: hop.status, headers: { location: hop.location } }));
      }
    }
    const servedUrl = resource.finalUrl ?? resource.requestedUrl;
    if (servedUrl !== resource.requestedUrl && !resource.redirectChain.length && !responses.has(resource.requestedUrl)) {
      // A crawler-side variant (e.g. a static-export .html page) was served
      // for this request; replay it as the same final document.
      responses.set(resource.requestedUrl, () => new Response(null, { status: 301, headers: { location: servedUrl } }));
    }
    if (resource.outcome === "fetched" && body) {
      responses.set(servedUrl, () => new Response(new Uint8Array(body), {
        status: resource.status ?? 200,
        headers: replayHeaders(resource)
      }));
    } else if (resource.status && !responses.has(servedUrl)) {
      responses.set(servedUrl, () => new Response(null, { status: resource.status }));
    }
  }
  return {
    validateUrl: async (url) => new URL(url).href,
    sleep: async () => undefined,
    fetchImpl: (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return responses.get(url)?.() ?? new Response("not retained", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch,
    browserFetch: async (url) => {
      const html = rendered.get(url);
      if (html === undefined) throw new Error("rendered_document_not_retained");
      return html;
    }
  };
}

function replayHeaders(resource: SourceSnapshotResource) {
  // Bodies are replayed decoded, so transfer framing headers no longer apply.
  const headers = Object.fromEntries(Object.entries(resource.headers)
    .filter(([name]) => !/^(?:content-encoding|content-length|transfer-encoding)$/i.test(name)));
  if (resource.contentType) headers["content-type"] = resource.contentType;
  return headers;
}
