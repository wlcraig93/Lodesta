import { gunzipSync, gzipSync } from "node:zlib";
import {
  sourceSnapshotPageSchema,
  sourceSnapshotResourceSchema,
  websiteSourceSnapshotPayloadSchema,
  type SourceSnapshotPage,
  type SourceSnapshotResource,
  type WebsiteSourceSnapshotPayload
} from "@/packages/site-contracts";
import { sha256, stableJson } from "./hash";
import type {
  GenerationCrawlCapture,
  GenerationCrawlDocument,
  WebsiteGenerationIngestion
} from "./generation-crawler";

export type RetainedSourceResource = { resource: SourceSnapshotResource; bytes?: Buffer };

export function websiteMirrorManifestHash(input: {
  ingestion: WebsiteGenerationIngestion;
  captures: GenerationCrawlCapture[];
}) {
  const captures = completeDocumentTerminals(input.ingestion, coalesceCaptures(input.captures));
  return sha256(stableJson(canonicalCaptureManifest(captures)));
}

export function buildWebsiteSourceMirror(input: {
  sourceSnapshotId: string;
  sourceUrl: string;
  ingestion: WebsiteGenerationIngestion;
  captures: GenerationCrawlCapture[];
  documents: GenerationCrawlDocument[];
  capturedAt: string;
  timings: {
    discoveryMs: number;
    documentFetchMs: number;
    dependencyFetchMs: number;
    browserFallbackMs: number;
  };
}): {
  payload: WebsiteSourceSnapshotPayload;
  resources: RetainedSourceResource[];
  pages: SourceSnapshotPage[];
} {
  const pageIndexStarted = Date.now();
  const captures = completeDocumentTerminals(input.ingestion, coalesceCaptures(input.captures));
  const resourceByCaptureKey = new Map<string, SourceSnapshotResource>();
  const resourceEntries = captures.map((capture): RetainedSourceResource => {
    const bytes = capture.bytes;
    const rawContentHash = bytes ? sha256(bytes) : undefined;
    const storedEncoding = bytes && shouldCompress(capture.contentType, capture.role) ? "gzip" as const : bytes ? "identity" as const : undefined;
    const stored = bytes ? storedEncoding === "gzip" ? gzipSync(bytes, { level: 9 }) : bytes : undefined;
    const blobContentHash = stored ? sha256(stored) : undefined;
    const resource = sourceSnapshotResourceSchema.parse({
      schemaVersion: 1,
      id: deterministicId("source_resource", {
        sourceSnapshotId: input.sourceSnapshotId,
        captureKind: capture.captureKind,
        role: capture.role,
        requestedUrl: capture.requestedUrl,
        rawContentHash,
        outcome: capture.outcome
      }),
      sourceSnapshotId: input.sourceSnapshotId,
      captureKind: capture.captureKind,
      role: capture.role,
      requestedUrl: capture.requestedUrl,
      finalUrl: capture.finalUrl,
      outcome: capture.outcome,
      reason: capture.reason,
      status: capture.status,
      contentType: capture.contentType?.slice(0, 200),
      storedEncoding,
      rawContentHash,
      blobContentHash,
      storageKey: blobContentHash ? `source-mirror/${blobContentHash.slice(7)}${storedEncoding === "gzip" ? ".gz" : ".bin"}` : undefined,
      rawBytes: bytes?.length ?? 0,
      storedBytes: stored?.length ?? 0,
      headers: capture.headers,
      redirectChain: capture.redirectChain,
      initiatorUrls: [...new Set(capture.initiatorUrls)].sort(),
      capturedAt: input.capturedAt,
      metadata: capture.metadata ?? {}
    });
    resourceByCaptureKey.set(capture.key, resource);
    return { resource, bytes: stored };
  });

  const documentByRequestedUrl = new Map(input.documents.map((document) => [document.url, document]));
  const resourceByDocumentUrl = new Map(resourceEntries
    .filter(({ resource }) => resource.role === "document")
    .map(({ resource }) => [resource.requestedUrl, resource]));
  const rawHashFirstPage = new Map<string, string>();
  const incomingLinks = new Map<string, number>();
  for (const page of input.ingestion.pages) {
    for (const target of page.internalLinks) {
      const normalized = pathForUrl(target);
      incomingLinks.set(normalized, (incomingLinks.get(normalized) ?? 0) + 1);
    }
  }
  const pages = input.ingestion.pages.map((page) => {
    const pageId = deterministicId("source_page", { sourceSnapshotId: input.sourceSnapshotId, requestedUrl: page.url });
    const resource = page.rawCaptureKey
      ? resourceByCaptureKey.get(page.rawCaptureKey)
      : resourceByDocumentUrl.get(page.url);
    if (!resource) throw new Error(`Source page ${page.url} is missing its terminal resource manifest row.`);
    const renderedResource = page.renderedCaptureKey ? resourceByCaptureKey.get(page.renderedCaptureKey) : undefined;
    const rawHash = resource.rawContentHash;
    const exactDuplicateOf = rawHash ? rawHashFirstPage.get(rawHash) : undefined;
    if (rawHash && !exactDuplicateOf) rawHashFirstPage.set(rawHash, pageId);
    const document = documentByRequestedUrl.get(page.url);
    const extractedText = document?.extractedText ?? "";
    return sourceSnapshotPageSchema.parse({
      schemaVersion: 1,
      id: pageId,
      sourceSnapshotId: input.sourceSnapshotId,
      resourceId: resource.id,
      renderedResourceId: renderedResource?.id,
      requestedUrl: page.url,
      finalUrl: page.finalUrl,
      path: pathForUrl(page.url),
      outcome: page.outcome,
      reason: page.reason,
      status: page.status,
      contentType: page.contentType,
      canonical: page.canonical,
      indexability: page.indexability,
      sitemap: page.sitemapUrl ? { url: page.sitemapUrl, lastModified: normalizedSitemapDate(page.sitemapLastModified) } : undefined,
      title: page.title,
      headings: page.headings,
      wordCount: page.wordCount,
      internalLinks: page.internalLinks,
      externalLinks: page.externalLinks,
      rawContentHash: rawHash,
      exactDuplicateOf,
      templateSignature: document ? sha256(normalizeDomTemplate(document.html, document.summary)) : undefined,
      linkProminence: incomingLinks.get(pathForUrl(page.url)) ?? 0,
      extractedText,
      textContentHash: sha256(extractedText),
      producer: "lodesta-source-page-index@1",
      inputHash: rawHash ?? sha256(stableJson({ outcome: page.outcome, reason: page.reason, url: page.url })),
      createdAt: input.capturedAt
    });
  });
  const pageIndexMs = Math.max(0, Date.now() - pageIndexStarted);
  const manifestHash = sha256(stableJson(canonicalCaptureManifest(captures)));
  const dependencies = resourceEntries.filter(({ resource }) => !["robots", "sitemap", "document", "rendered_document"].includes(resource.role));
  const countResources = (outcome: SourceSnapshotResource["outcome"]) => dependencies.filter(({ resource }) => resource.outcome === outcome).length;
  const payload = websiteSourceSnapshotPayloadSchema.parse({
    schemaVersion: 1,
    kind: "website-mirror",
    sourceUrl: input.sourceUrl,
    coverage: input.ingestion.coverage,
    completionReason: input.ingestion.completionReason,
    manifestHash,
    counts: {
      documentsDiscovered: input.ingestion.counts.discovered,
      documentsEligible: input.ingestion.counts.eligible,
      documentsFetched: input.ingestion.counts.fetched,
      documentsExcluded: input.ingestion.counts.excluded,
      documentsFailed: input.ingestion.counts.failed,
      documentsUnfinished: input.ingestion.counts.unfinished,
      resourcesDiscovered: dependencies.length,
      resourcesFetched: countResources("fetched"),
      resourcesExcluded: countResources("excluded"),
      resourcesFailed: countResources("failed"),
      resourcesUnfinished: countResources("unfinished"),
      browserRendered: input.ingestion.counts.browserRendered,
      uniqueBlobs: new Set(resourceEntries.flatMap(({ resource }) => resource.blobContentHash ? [resource.blobContentHash] : [])).size,
      rawBytes: input.ingestion.counts.rawBytes,
      storedBytes: resourceEntries.reduce((total, { resource }) => total + resource.storedBytes, 0)
    },
    stages: {
      ...input.timings,
      blobPersistenceMs: 0,
      pageIndexMs,
      factExtractionMs: 0,
      finalizationMs: 0
    },
    startedAt: input.ingestion.startedAt,
    completedAt: input.ingestion.completedAt,
    elapsedMs: input.ingestion.elapsedMs
  });
  return { payload, resources: resourceEntries, pages };
}

export function decodeRetainedSourceResource(resource: SourceSnapshotResource, stored: Buffer) {
  if (!resource.blobContentHash || sha256(stored) !== resource.blobContentHash) throw new Error("source_resource_blob_hash_mismatch");
  if (!resource.rawContentHash || !resource.storedEncoding) throw new Error("source_resource_body_provenance_missing");
  const raw = resource.storedEncoding === "gzip" ? gunzipSync(stored) : stored;
  if (raw.length !== resource.rawBytes || sha256(raw) !== resource.rawContentHash) throw new Error("source_resource_raw_hash_mismatch");
  return raw;
}

function completeDocumentTerminals(ingestion: WebsiteGenerationIngestion, captures: GenerationCrawlCapture[]) {
  const capturedUrls = new Set(captures.filter((capture) => capture.role === "document").map((capture) => capture.requestedUrl));
  const terminals = ingestion.pages.flatMap((page): GenerationCrawlCapture[] => capturedUrls.has(page.url) ? [] : [{
    key: `terminal_document_${page.url}`,
    captureKind: "http_response",
    role: "document",
    requestedUrl: page.url,
    finalUrl: page.finalUrl,
    outcome: page.outcome,
    reason: page.reason,
    status: page.status,
    contentType: page.contentType,
    redirectChain: [],
    headers: {},
    initiatorUrls: []
  }]);
  return [...captures, ...terminals];
}

function coalesceCaptures(captures: GenerationCrawlCapture[]) {
  const retained = new Map<string, GenerationCrawlCapture>();
  for (const capture of captures) {
    const key = stableJson({
      captureKind: capture.captureKind,
      role: capture.role,
      requestedUrl: capture.requestedUrl,
      outcome: capture.outcome,
      contentHash: capture.bytes ? sha256(capture.bytes) : undefined
    });
    const prior = retained.get(key);
    if (!prior) retained.set(key, { ...capture, initiatorUrls: [...capture.initiatorUrls] });
    else prior.initiatorUrls = [...new Set([...prior.initiatorUrls, ...capture.initiatorUrls])].sort();
  }
  return [...retained.values()].sort((left, right) => left.requestedUrl.localeCompare(right.requestedUrl) || left.role.localeCompare(right.role));
}

function canonicalCaptureManifest(captures: GenerationCrawlCapture[]) {
  return captures.map((capture) => ({
    captureKind: capture.captureKind,
    role: capture.role,
    requestedUrl: capture.requestedUrl,
    finalUrl: capture.finalUrl,
    outcome: capture.outcome,
    reason: capture.reason,
    status: capture.status,
    contentType: capture.contentType,
    rawContentHash: capture.bytes && !(capture.reason === "not_found" && (capture.role === "robots" || capture.role === "sitemap"))
      ? sha256(capture.bytes)
      : undefined,
    headers: captureIdentityHeaders(capture.headers),
    redirectChain: capture.redirectChain,
    initiatorUrls: [...new Set(capture.initiatorUrls)].sort()
  })).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function captureIdentityHeaders(headers: Record<string, string>) {
  return Object.fromEntries(["content-language", "link", "location", "x-robots-tag"].flatMap((name) =>
    headers[name] === undefined ? [] : [[name, headers[name]]]
  ));
}

function shouldCompress(contentType: string | undefined, role: SourceSnapshotResource["role"]) {
  return ["robots", "sitemap", "document", "rendered_document", "stylesheet", "script", "data"].includes(role)
    || /(?:text|json|xml|javascript|svg)/i.test(contentType ?? "");
}

function normalizeDomTemplate(html: string, summary: GenerationCrawlDocument["summary"]) {
  const structure = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "<$1></$1>")
    .replace(/>[^<]+</g, "><")
    .replace(/\s(?:href|src|alt|title|content|aria-label|data-[\w-]+)=(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stableJson({ purposes: summary.purposeTags, forms: summary.formCount, images: summary.imageCount, structure });
}

function normalizedSitemapDate(value: string | undefined) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function pathForUrl(value: string) {
  const url = new URL(value);
  return `${url.pathname || "/"}${url.search}`;
}

function deterministicId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(stableJson(value)).slice(7, 31)}`;
}
