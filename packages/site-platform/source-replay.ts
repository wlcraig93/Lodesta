import { decodeRetainedSourceResource } from "@/packages/business-data";
import type { SitePlatformRepository } from "@/packages/platform-data";
import type { ArtifactBlobStore } from "@/packages/site-artifacts";
import type { SourceSnapshotPage, SourceSnapshotResource } from "@/packages/site-contracts";

export type SourceReplayResponse = {
  body: Buffer;
  contentType: string;
  status: number;
  headers: Record<string, string>;
};

export async function replaySourcePage(input: {
  sourceSnapshotId: string;
  path: string;
  replayRoot: string;
  repository: SitePlatformRepository;
  blobStore: ArtifactBlobStore;
}): Promise<SourceReplayResponse | undefined> {
  const [snapshot, pages, resources] = await Promise.all([
    input.repository.getSourceSnapshot(input.sourceSnapshotId),
    input.repository.listSourceSnapshotPages(input.sourceSnapshotId),
    input.repository.listSourceSnapshotResources(input.sourceSnapshotId)
  ]);
  if (!snapshot || snapshot.payload.kind !== "website-mirror") return undefined;
  const normalizedPath = normalizeReplayPath(input.path);
  const page = pages.find((candidate) => normalizeReplayPath(candidate.path) === normalizedPath)
    ?? pages.find((candidate) => stripQuery(normalizeReplayPath(candidate.path)) === stripQuery(normalizedPath));
  if (!page) return undefined;
  const resourceId = page.renderedResourceId ?? page.resourceId;
  const resource = resources.find((candidate) => candidate.id === resourceId);
  if (!resource) return undefined;
  const raw = await loadResourceBody(resource, input.blobStore);
  if (!raw) return undefined;
  const baseUrl = page.finalUrl ?? page.requestedUrl;
  const rewritten = rewriteHtml(raw.toString("utf8"), {
    baseUrl,
    replayRoot: input.replayRoot.replace(/\/$/, ""),
    sourceSnapshotId: input.sourceSnapshotId,
    pages,
    resources
  });
  return {
    body: Buffer.from(rewritten),
    contentType: "text/html; charset=utf-8",
    status: 200,
    headers: replayHeaders()
  };
}

export async function replaySourceResource(input: {
  sourceSnapshotId: string;
  resourceId: string;
  replayRoot: string;
  repository: SitePlatformRepository;
  blobStore: ArtifactBlobStore;
}): Promise<SourceReplayResponse | undefined> {
  const [resource, resources] = await Promise.all([
    input.repository.getSourceSnapshotResource(input.resourceId, input.sourceSnapshotId),
    input.repository.listSourceSnapshotResources(input.sourceSnapshotId)
  ]);
  if (!resource) return undefined;
  const raw = await loadResourceBody(resource, input.blobStore);
  if (!raw) return undefined;
  const contentType = resource.contentType ?? "application/octet-stream";
  let body = raw;
  if (/text\/css/i.test(contentType)) {
    body = Buffer.from(rewriteCss(raw.toString("utf8"), resource.finalUrl ?? resource.requestedUrl, input.replayRoot.replace(/\/$/, ""), input.sourceSnapshotId, resources));
  }
  return {
    body,
    contentType,
    status: resource.status && resource.status >= 200 && resource.status < 300 ? resource.status : 200,
    headers: replayHeaders()
  };
}

async function loadResourceBody(resource: SourceSnapshotResource, blobStore: ArtifactBlobStore) {
  if (!resource.storageKey) return undefined;
  const blob = await blobStore.get(resource.storageKey).catch(() => undefined);
  if (!blob) return undefined;
  try {
    return decodeRetainedSourceResource(resource, blob.bytes);
  } catch {
    return undefined;
  }
}

function rewriteHtml(html: string, input: {
  baseUrl: string;
  replayRoot: string;
  sourceSnapshotId: string;
  pages: SourceSnapshotPage[];
  resources: SourceSnapshotResource[];
}) {
  const resolve = replayUrlResolver(input);
  let output = html
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/\s(?:integrity|nonce)=(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/(<(?:img|script|iframe|source|video|audio|input)\b[^>]*?\s(?:src|poster)=)(["'])([^"']*)\2/gi, (_match, prefix: string, quote: string, value: string) => `${prefix}${quote}${resolve(value, "resource")}${quote}`)
    .replace(/(<link\b[^>]*?\shref=)(["'])([^"']*)\2/gi, (_match, prefix: string, quote: string, value: string) => `${prefix}${quote}${resolve(value, "resource")}${quote}`)
    .replace(/(<a\b[^>]*?\shref=)(["'])([^"']*)\2/gi, (_match, prefix: string, quote: string, value: string) => `${prefix}${quote}${resolve(value, "navigation")}${quote}`)
    .replace(/(<(?:img|source)\b[^>]*?\ssrcset=)(["'])([^"']*)\2/gi, (_match, prefix: string, quote: string, value: string) => `${prefix}${quote}${rewriteSrcset(value, (url) => resolve(url, "resource"))}${quote}`)
    .replace(/(<[^>]+\sstyle=)(["'])([^"']*)\2/gi, (_match, prefix: string, quote: string, value: string) => `${prefix}${quote}${rewriteCss(value, input.baseUrl, input.replayRoot, input.sourceSnapshotId, input.resources)}${quote}`)
    .replace(/(<form\b[^>]*?\saction=)(["'])([^"']*)\2/gi, "$1$2#$2")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const marker = `<meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'">`;
  output = /<head\b[^>]*>/i.test(output)
    ? output.replace(/<head\b[^>]*>/i, (head) => `${head}${marker}`)
    : `${marker}${output}`;
  return output;
}

function rewriteCss(css: string, baseUrl: string, replayRoot: string, sourceSnapshotId: string, resources: SourceSnapshotResource[]) {
  const resolve = replayUrlResolver({ baseUrl, replayRoot, sourceSnapshotId, pages: [], resources });
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (_match, quote: string, value: string) => `url(${quote}${resolve(value, "resource")}${quote})`)
    .replace(/@import\s+(["'])([^"']+)\1/gi, (_match, quote: string, value: string) => `@import ${quote}${resolve(value, "resource")}${quote}`);
}

function replayUrlResolver(input: {
  baseUrl: string;
  replayRoot: string;
  sourceSnapshotId: string;
  pages: SourceSnapshotPage[];
  resources: SourceSnapshotResource[];
}) {
  const resourceByUrl = new Map<string, SourceSnapshotResource>();
  for (const resource of input.resources) {
    if (resource.outcome !== "fetched" || !resource.storageKey) continue;
    resourceByUrl.set(normalizeCapturedUrl(resource.requestedUrl), resource);
    if (resource.finalUrl) resourceByUrl.set(normalizeCapturedUrl(resource.finalUrl), resource);
  }
  const pageByUrl = new Map<string, SourceSnapshotPage>();
  for (const page of input.pages) {
    if (page.outcome !== "fetched") continue;
    pageByUrl.set(normalizeCapturedUrl(page.requestedUrl), page);
    if (page.finalUrl) pageByUrl.set(normalizeCapturedUrl(page.finalUrl), page);
  }
  return (value: string, kind: "resource" | "navigation") => {
    const trimmed = decodeHtmlUrl(value.trim());
    if (!trimmed || trimmed.startsWith("#") || /^(?:data|blob|mailto|tel|sms|javascript):/i.test(trimmed)) return trimmed;
    let resolved: URL;
    try {
      resolved = new URL(trimmed, input.baseUrl);
    } catch {
      return kind === "navigation" ? "#" : "about:blank";
    }
    const normalized = normalizeCapturedUrl(resolved.href);
    const page = pageByUrl.get(normalized);
    if (page) return `${input.replayRoot}/${input.sourceSnapshotId}/replay${page.path === "/" ? "" : page.path}${resolved.hash}`;
    const resource = resourceByUrl.get(normalized);
    if (resource) return `${input.replayRoot}/${input.sourceSnapshotId}/resources/${resource.id}`;
    return kind === "navigation" ? "#" : "about:blank";
  };
}

function rewriteSrcset(value: string, rewrite: (url: string) => string) {
  if (value.trim().startsWith("data:")) return value;
  return value.split(",").map((candidate) => {
    const [url, ...descriptor] = candidate.trim().split(/\s+/);
    return [rewrite(url ?? ""), ...descriptor].filter(Boolean).join(" ");
  }).join(", ");
}

function decodeHtmlUrl(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#38;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function normalizeCapturedUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function normalizeReplayPath(value: string) {
  const [pathname, query] = value.split("?", 2);
  const normalized = pathname === "/" ? "/" : `/${pathname.replace(/^\/+|\/+$/g, "")}`;
  return query ? `${normalized}?${query}` : normalized;
}

function stripQuery(value: string) {
  return value.split("?", 1)[0] ?? value;
}

function replayHeaders() {
  return {
    "cache-control": "private, no-store",
    "content-security-policy": "default-src 'self' data: blob:; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow"
  };
}
