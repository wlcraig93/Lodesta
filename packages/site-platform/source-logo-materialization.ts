import { sha256, stableJson } from "@/packages/business-data";
import { decodeRetainedSourceResource, type RetainedSourceResource } from "@/packages/business-data/source-mirror";
import { DomUtils, parseDocument } from "htmlparser2";
import sharp from "sharp";
import {
  assetRevisionRefSchema,
  assetRevisionSchema,
  type AssetRevision,
  type AssetRevisionRef,
  type SourceSnapshot,
  type SourceSnapshotPage
} from "@/packages/site-contracts";
import {
  logoPresentationRecipeVersion,
  prepareLogoPresentation,
  type PreparedLogoPresentation,
  type UnusableLogoPresentation
} from "./logo-preparation";
import { rankSourceAssetCandidates, type SourceAssetCandidate } from "./source-resource-ranking";

type SourceLogoMimeType = "image/png" | "image/jpeg" | "image/webp";
type SourceLogoInputMimeType = SourceLogoMimeType | "image/svg+xml";
type UnsupportedSourceSvg = {
  status: "unusable";
  reason: "unsupported_svg";
  message: string;
};
type SourceLogoUnusable = UnusableLogoPresentation | UnsupportedSourceSvg;

const maximumSourceLogoPixels = 12_000_000;
const maximumSourceSvgBytes = 32 * 1024 * 1024;
const svgRasterDensity = 72;
const svgCooperativeTimeoutSeconds = 2;

export type SourceLogoMaterialization = {
  status: "prepared";
  presentation: PreparedLogoPresentation;
  bytes: Buffer;
  mimeType: SourceLogoMimeType;
  contentHash: `sha256:${string}`;
  revisionIdentity: {
    sourceRevisionId: string;
    sourceContentHash: `sha256:${string}`;
    logoPresentationRecipeVersion: typeof logoPresentationRecipeVersion;
  };
  preparation: {
    processor: "sharp";
    recipe: "logo-presentation";
    recipeVersion: typeof logoPresentationRecipeVersion;
    sourceContentHash: `sha256:${string}`;
    operations: Array<"rasterize_svg" | PreparedLogoPresentation["operations"][number]>;
    sourceWidth: number;
    sourceHeight: number;
    contentBounds: PreparedLogoPresentation["contentBounds"];
    backgroundColor?: string;
    confidence: number;
  };
};

export type CanonicalSourceLogo = {
  status: "canonical";
  candidate: SourceAssetCandidate;
  materialization: SourceLogoMaterialization;
  revision: AssetRevision;
  ref: AssetRevisionRef;
};

export type CanonicalSourceLogoUnavailable = {
  status: "unavailable";
  reason: "no_logo_candidate" | "logo_candidates_unusable";
  unusableCandidates: Array<{ resourceId: string; reason: SourceLogoUnusable["reason"] }>;
};

export async function materializeSourceLogo(input: {
  bytes: Buffer;
  mimeType: SourceLogoInputMimeType;
  sourceRevisionId: string;
  sourceContentHash: `sha256:${string}`;
}): Promise<SourceLogoMaterialization | SourceLogoUnusable> {
  const rasterized = input.mimeType === "image/svg+xml"
    ? await rasterizeSelfContainedSourceSvg(input.bytes)
    : { status: "prepared" as const, bytes: input.bytes, mimeType: input.mimeType };
  if (rasterized.status === "unusable") return rasterized;
  const presentation = await prepareLogoPresentation({ bytes: rasterized.bytes, mimeType: rasterized.mimeType });
  if (presentation.status === "unusable") return presentation;
  const bytes = presentation.bytes;
  const rasterizedSvg = input.mimeType === "image/svg+xml";
  const materializedPresentation = rasterizedSvg ? { ...presentation, changed: true as const } : presentation;
  return {
    status: "prepared",
    presentation: materializedPresentation,
    bytes,
    mimeType: materializedPresentation.mimeType,
    contentHash: materializedPresentation.changed ? sha256(bytes) : input.sourceContentHash,
    revisionIdentity: {
      sourceRevisionId: input.sourceRevisionId,
      sourceContentHash: input.sourceContentHash,
      logoPresentationRecipeVersion
    },
    preparation: {
      processor: "sharp",
      recipe: "logo-presentation",
      recipeVersion: logoPresentationRecipeVersion,
      sourceContentHash: input.sourceContentHash,
      operations: rasterizedSvg ? ["rasterize_svg", ...presentation.operations] : presentation.operations,
      sourceWidth: presentation.sourceWidth,
      sourceHeight: presentation.sourceHeight,
      contentBounds: presentation.contentBounds,
      ...(presentation.backgroundColor ? { backgroundColor: presentation.backgroundColor } : {}),
      confidence: presentation.confidence
    }
  };
}

export function sourceLogoPreparedRevisionId(input: {
  sourceRevisionId: string;
  sourceContentHash: `sha256:${string}`;
}) {
  return deterministicId("asset_revision", {
    sourceRevisionId: input.sourceRevisionId,
    sourceContentHash: input.sourceContentHash,
    logoPresentationRecipeVersion
  });
}

export function canonicalSourceLogoAssetId(businessId: string) {
  return deterministicId("asset", { businessId, role: "canonical-source-logo" });
}

export function canonicalSourceLogoRevisionId(input: {
  sourceSnapshotId: string;
  sourceContentHash: `sha256:${string}`;
}) {
  return deterministicId("asset_revision", {
    sourceSnapshotId: input.sourceSnapshotId,
    sourceContentHash: input.sourceContentHash,
    logoPresentationRecipeVersion
  });
}

/**
 * Selects and materializes exactly one source logo. Raw crawl resources remain
 * immutable evidence; callers persist only this canonical presentation asset.
 */
export async function materializeCanonicalSourceLogo(input: {
  snapshot: SourceSnapshot;
  resources: RetainedSourceResource[];
  pages: SourceSnapshotPage[];
  businessName: string;
  /** An author may identify a missed mark from retained pixels only when no active logo exists. */
  selectedResourceId?: string;
}): Promise<CanonicalSourceLogo | CanonicalSourceLogoUnavailable> {
  const rankedCandidates = rankSourceAssetCandidates({
    resources: input.resources.map(({ resource }) => resource),
    pages: input.pages,
    includeSvgLogoCandidates: true
  }).filter((candidate) => input.selectedResourceId
    ? candidate.resource.id === input.selectedResourceId
    : candidate.likelyKind === "logo");
  const candidates = input.selectedResourceId
    ? rankedCandidates
    : homepageHomeLinkLogoCandidates(rankedCandidates, input.pages, input.resources);
  if (!candidates.length) {
    return { status: "unavailable", reason: "no_logo_candidate", unusableCandidates: [] };
  }

  const retainedById = new Map(input.resources.map((entry) => [entry.resource.id, entry]));
  const unusableCandidates: CanonicalSourceLogoUnavailable["unusableCandidates"] = [];
  for (const candidate of candidates) {
    const retained = retainedById.get(candidate.resource.id);
    if (!retained?.bytes || !candidate.resource.rawContentHash) continue;
    const mimeType = candidate.resource.contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp" && mimeType !== "image/svg+xml") continue;
    let raw: Buffer;
    try {
      raw = decodeRetainedSourceResource(candidate.resource, retained.bytes);
    } catch {
      unusableCandidates.push({ resourceId: candidate.resource.id, reason: "decode_failed" });
      continue;
    }
    const materialization = await materializeSourceLogo({
      bytes: raw,
      mimeType,
      sourceRevisionId: candidate.resource.id,
      sourceContentHash: asContentHash(candidate.resource.rawContentHash)
    });
    if (materialization.status === "unusable") {
      unusableCandidates.push({ resourceId: candidate.resource.id, reason: materialization.reason });
      continue;
    }

    const assetId = canonicalSourceLogoAssetId(input.snapshot.businessId);
    const revisionId = canonicalSourceLogoRevisionId({
      sourceSnapshotId: input.snapshot.id,
      sourceContentHash: asContentHash(candidate.resource.rawContentHash)
    });
    const storageKey = `site-assets/${input.snapshot.businessId}/source-logo/${revisionId}/${materialization.contentHash.slice("sha256:".length)}`;
    const revision = assetRevisionSchema.parse({
      schemaVersion: 1,
      id: revisionId,
      assetId,
      businessId: input.snapshot.businessId,
      contentHash: materialization.contentHash,
      storageKey,
      mimeType: materialization.mimeType,
      bytes: materialization.bytes.byteLength,
      width: materialization.presentation.width,
      height: materialization.presentation.height,
      origin: "source_website",
      provenance: {
        origin: "source_website",
        sourceUrl: candidate.resource.finalUrl ?? candidate.resource.requestedUrl,
        sourcePageUrl: candidate.sourcePageUrl,
        sourceSnapshotId: input.snapshot.id,
        ...(mimeType === "image/svg+xml" ? { sourceResourceId: candidate.resource.id } : {}),
        alt: `${input.businessName} logo`,
        preparation: materialization.preparation
      },
      createdAt: input.snapshot.capturedAt
    });
    const ref = assetRevisionRefSchema.parse({
      assetId,
      revisionId,
      kind: "logo",
      contentHash: revision.contentHash,
      storageKey: revision.storageKey,
      mimeType: revision.mimeType,
      alt: `${input.businessName} logo`,
      width: revision.width,
      height: revision.height,
      origin: "source_website",
      sourceFactIds: [],
      activeForFutureBuilds: true
    });
    return { status: "canonical", candidate, materialization, revision, ref };
  }

  return { status: "unavailable", reason: "logo_candidates_unusable", unusableCandidates };
}

/**
 * A customer homepage's image link back to that same homepage is stronger
 * identity evidence than a generic `logo` filename. When retained HTML supplies
 * that evidence, restrict selection to that group: an unusable header mark must
 * not fall through to a partner or specialist logo. Multiple linked variants
 * preserve the existing relative ranking. Without retained document evidence,
 * ordinary ranking remains the fallback.
 */
function homepageHomeLinkLogoCandidates(
  candidates: SourceAssetCandidate[],
  pages: SourceSnapshotPage[],
  resources: RetainedSourceResource[]
) {
  if (candidates.length < 2) return candidates;
  const retainedById = new Map(resources.map((entry) => [entry.resource.id, entry]));
  const homeLinkedImages = new Set<string>();
  for (const page of pages.filter((candidate) => candidate.path === "/")) {
    const retained = retainedById.get(page.resourceId);
    if (!retained?.bytes || !/text\/html/i.test(retained.resource.contentType ?? "")) continue;
    let html: string;
    try {
      html = decodeRetainedSourceResource(retained.resource, retained.bytes).toString("utf8");
    } catch {
      continue;
    }
    for (const imageUrl of homepageHomeLinkImageUrls(html, page.finalUrl ?? page.requestedUrl)) {
      homeLinkedImages.add(imageUrl);
    }
  }
  const matched = candidates.filter((candidate) =>
    homeLinkedImages.has(normalizedEvidenceUrl(candidate.resource.finalUrl ?? candidate.resource.requestedUrl))
  );
  return matched.length ? matched.map((candidate) => ({
    ...candidate,
    relevanceReasons: [...candidate.relevanceReasons, "image is linked to the homepage from the retained homepage"]
  })) : candidates;
}

function homepageHomeLinkImageUrls(html: string, homepageUrl: string) {
  const values = new Set<string>();
  const document = parseDocument(html, { decodeEntities: true });
  const anchors = DomUtils.findAll(
    (node) => node.type === "tag" && node.name === "a",
    document.children
  );
  for (const anchor of anchors) {
    const href = anchor.attribs.href;
    if (!href || !isHomepageTarget(href, homepageUrl)) continue;
    const images = DomUtils.findAll(
      (node) => node.type === "tag" && node.name === "img",
      anchor.children
    );
    for (const image of images) {
      for (const name of ["src", "data-src"]) {
        const value = image.attribs[name];
        if (value) values.add(normalizedEvidenceUrl(value, homepageUrl));
      }
      const srcset = image.attribs.srcset;
      for (const entry of srcset?.split(",") ?? []) {
        const value = entry.trim().split(/\s+/, 1)[0];
        if (value) values.add(normalizedEvidenceUrl(value, homepageUrl));
      }
    }
  }
  return values;
}

function isHomepageTarget(value: string, homepageUrl: string) {
  if (!value.trim() || /^[#?]/.test(value.trim())) return false;
  try {
    const target = new URL(value, homepageUrl);
    const homepage = new URL(homepageUrl);
    return target.origin === homepage.origin && target.pathname.replace(/\/+$/, "") === homepage.pathname.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

function normalizedEvidenceUrl(value: string, base?: string) {
  try {
    const url = new URL(value.replaceAll("&amp;", "&"), base);
    url.hash = "";
    return url.href;
  } catch {
    return value;
  }
}

/**
 * Accepts only a deliberately small, self-contained SVG subset. This is a
 * bounded rejection screen for source-logo fidelity, not an XML sanitizer or
 * an exhaustive parser/security boundary.
 */
async function rasterizeSelfContainedSourceSvg(bytes: Buffer): Promise<
  { status: "prepared"; bytes: Buffer; mimeType: "image/png" } | SourceLogoUnusable
> {
  const eligibility = inspectSelfContainedSourceSvg(bytes);
  if (eligibility) return eligibility;
  try {
    const image = sharp(bytes, {
      animated: false,
      unlimited: false,
      failOn: "warning",
      limitInputPixels: 80_000_000,
      density: svgRasterDensity
    }).timeout({ seconds: svgCooperativeTimeoutSeconds });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      return { status: "unusable", reason: "dimensions_missing", message: "dimensions_missing" };
    }
    if (metadata.width * metadata.height > maximumSourceLogoPixels) {
      return { status: "unusable", reason: "pixel_limit_exceeded", message: "pixel_limit_exceeded" };
    }
    const output = await image
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    return { status: "prepared", bytes: output, mimeType: "image/png" };
  } catch {
    return {
      status: "unusable",
      reason: "decode_failed",
      message: "decode_failed"
    };
  }
}

function inspectSelfContainedSourceSvg(bytes: Buffer): SourceLogoUnusable | undefined {
  if (bytes.byteLength > maximumSourceSvgBytes) return unsupportedSvg("SVG input exceeds the retained source byte limit");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return unsupportedSvg("unsupported SVG text encoding");
  }
  if (source.includes("\u0000")) return unsupportedSvg("unsupported SVG text encoding");
  if (source.includes("\\")) return unsupportedSvg("CSS and XML escape syntax is outside the supported subset");
  const declaredEncoding = source.match(/<\?xml\b[^>]*\bencoding\s*=\s*(["'])(.*?)\1[^>]*\?>/i)?.[2]?.trim().toLowerCase();
  if (declaredEncoding && declaredEncoding !== "utf-8" && declaredEncoding !== "utf8") {
    return unsupportedSvg("only UTF-8 SVG text is supported");
  }
  const opening = source.match(/<svg\b[^>]*>/i)?.[0];
  if (!opening) return { status: "unusable", reason: "decode_failed", message: "decode_failed: missing svg root" };
  if (!svgRootHasDimensions(opening)) {
    return { status: "unusable", reason: "dimensions_missing", message: "dimensions_missing" };
  }
  if (/<!doctype\b|<!entity\b|<\?xml-stylesheet\b/i.test(source)) {
    return unsupportedSvg("DTD, entity, or XML stylesheet declarations are outside the supported subset");
  }
  if (/<(?:[a-z][\w.-]*:)?(?:script|foreignObject|image|object|embed|iframe|include)\b/i.test(source)) {
    return unsupportedSvg("script, embedded content, foreignObject, and include elements are outside the supported subset");
  }
  if (/\son[a-z][\w.-]*\s*=/i.test(source)) {
    return unsupportedSvg("event-handler attributes are outside the supported subset");
  }
  if (/@import\b/i.test(source)) {
    return unsupportedSvg("CSS imports are outside the supported subset");
  }
  for (const match of source.matchAll(/\b(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gis)) {
    if (!match[2]?.trim().startsWith("#")) return unsupportedSvg("non-fragment references are outside the supported subset");
  }
  for (const match of source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gis)) {
    if (!match[2]?.trim().startsWith("#")) return unsupportedSvg("non-fragment URL references are outside the supported subset");
  }
  if (/\b(?:data|file|https?):/i.test(source.replace(/xmlns(?::\w+)?\s*=\s*["'][^"']*["']/gi, ""))) {
    return unsupportedSvg("embedded or external URI references are outside the supported subset");
  }
  const entityReferences = source.match(/&(?:#\d+|#x[a-f0-9]+|[a-z][\w.-]*);/gi) ?? [];
  if (entityReferences.some((reference) => !/^&(amp|lt|gt|quot|apos|#\d+|#x[a-f0-9]+);$/i.test(reference))) {
    return unsupportedSvg("custom entity references are outside the supported subset");
  }
  return undefined;
}

function svgRootHasDimensions(opening: string) {
  const viewBox = opening.match(/\sviewBox\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[3]! > 0) return true;
  const width = opening.match(/\swidth\s*=\s*(["'])(.*?)\1/i)?.[2];
  const height = opening.match(/\sheight\s*=\s*(["'])(.*?)\1/i)?.[2];
  return svgAbsoluteDimensionIsPositive(width) && svgAbsoluteDimensionIsPositive(height);
}

function svgAbsoluteDimensionIsPositive(value: string | undefined) {
  if (!value) return false;
  const match = value.trim().match(/^\+?((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:px|in|cm|mm|q|pt|pc)?$/i);
  return Boolean(match && Number.isFinite(Number(match[1])) && Number(match[1]) > 0);
}

function unsupportedSvg(message: string): UnsupportedSourceSvg {
  return { status: "unusable", reason: "unsupported_svg", message: `unsupported_svg: ${message}` };
}

function deterministicId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(stableJson(value)).slice("sha256:".length, "sha256:".length + 32)}`;
}

function asContentHash(value: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error("Expected a SHA-256 content hash.");
  return value as `sha256:${string}`;
}
