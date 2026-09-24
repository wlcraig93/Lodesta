import type {
  SourceSnapshotPage,
  SourceSnapshotResource
} from "@/packages/site-contracts";
import { classifySourcePagePath } from "@/packages/business-data/source-page-classification";
import {
  firstPartyImageHost,
  firstPartySupportFromSnapshotPages,
  isStockOrMarketplaceImageHost
} from "@/packages/business-data/first-party-support";

export type SourceAssetCandidate = {
  resource: SourceSnapshotResource;
  sourcePageId: string;
  sourcePageUrl: string;
  likelyKind: "logo" | "photo" | "icon" | "other";
  /** Loaded by a first-party page from the business's own or a first-party media host. */
  firstPartyHost: boolean;
  relevanceScore: number;
  relevanceReasons: string[];
};

const adoptableImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export function rankSourceAssetCandidates(input: {
  resources: SourceSnapshotResource[];
  pages: SourceSnapshotPage[];
  /** Only the canonical logo materializer may opt into retained SVG candidates. */
  includeSvgLogoCandidates?: boolean;
}) {
  const pagesByUrl = new Map<string, SourceSnapshotPage>();
  for (const page of input.pages) {
    pagesByUrl.set(page.requestedUrl, page);
    if (page.finalUrl) pagesByUrl.set(page.finalUrl, page);
  }
  const stylesheetsByUrl = new Map<string, SourceSnapshotResource>();
  for (const resource of input.resources) {
    if (resource.role !== "stylesheet") continue;
    stylesheetsByUrl.set(resource.requestedUrl, resource);
    if (resource.finalUrl) stylesheetsByUrl.set(resource.finalUrl, resource);
  }
  const homepage = input.pages.find((page) => page.path === "/");
  // Other websites the business links to (partners, manufacturers) are not
  // its media hosts; every other non-stock host its pages load images from is.
  const linkedOtherSiteDomains = homepage
    ? firstPartySupportFromSnapshotPages(input.pages).linkedOtherSiteDomains(new URL(homepage.finalUrl ?? homepage.requestedUrl).hostname)
    : new Set<string>();
  const strongestByVisualIdentity = new Map<string, SourceAssetCandidate>();
  for (const resource of input.resources) {
    if (!sourceResourceIsAdoptableImage(resource)
      && !(input.includeSvgLogoCandidates && sourceResourceIsPersistedSvg(resource))) continue;
    const sourcePage = sourceInitiatorPages(resource.initiatorUrls, pagesByUrl, stylesheetsByUrl, homepage)
      .sort((left, right) => sourcePageAssociationScore(right) - sourcePageAssociationScore(left))[0];
    if (!sourcePage) continue;
    const candidate = sourceAssetCandidate(resource, sourcePage, linkedOtherSiteDomains);
    const identity = sourceImageFamily(resource.finalUrl ?? resource.requestedUrl);
    const current = strongestByVisualIdentity.get(identity);
    if (!current
      || candidate.relevanceScore > current.relevanceScore
      || candidate.relevanceScore === current.relevanceScore
        && (candidate.resource.rawBytes ?? 0) > (current.resource.rawBytes ?? 0)) {
      strongestByVisualIdentity.set(identity, candidate);
    }
  }
  return [...strongestByVisualIdentity.values()].sort((left, right) =>
    right.relevanceScore - left.relevanceScore
    || (right.resource.rawBytes ?? 0) - (left.resource.rawBytes ?? 0)
    || left.resource.id.localeCompare(right.resource.id)
  );
}

/**
 * Pages that load an image. An image referenced only from a stylesheet (a CSS
 * background) belongs to the pages that load that stylesheet, following
 * nested imports; a retained stylesheet with no retained page falls back to
 * the homepage rather than dropping the photograph.
 */
function sourceInitiatorPages(
  initiatorUrls: readonly string[],
  pagesByUrl: Map<string, SourceSnapshotPage>,
  stylesheetsByUrl: Map<string, SourceSnapshotResource>,
  homepage: SourceSnapshotPage | undefined
) {
  const direct = initiatorUrls
    .map((url) => pagesByUrl.get(url))
    .filter((page): page is SourceSnapshotPage => Boolean(page));
  if (direct.length) return direct;
  const pages = new Set<SourceSnapshotPage>();
  let viaStylesheet = false;
  const visited = new Set<string>();
  let frontier = [...initiatorUrls];
  for (let depth = 0; frontier.length && depth < 4; depth += 1) {
    const next: string[] = [];
    for (const url of frontier) {
      if (visited.has(url)) continue;
      visited.add(url);
      const page = pagesByUrl.get(url);
      if (page) {
        pages.add(page);
        continue;
      }
      const stylesheet = stylesheetsByUrl.get(url);
      if (stylesheet) {
        viaStylesheet = true;
        next.push(...stylesheet.initiatorUrls);
      }
    }
    frontier = next;
  }
  if (!pages.size && viaStylesheet && homepage) pages.add(homepage);
  return [...pages];
}

export function sourcePhotoCountsByPagePath(input: {
  resources: SourceSnapshotResource[];
  pages: SourceSnapshotPage[];
}) {
  const pagesById = new Map(input.pages.map((page) => [page.id, page]));
  const counts = new Map<string, number>();
  for (const candidate of rankSourceAssetCandidates(input)) {
    if (candidate.likelyKind !== "photo") continue;
    const page = pagesById.get(candidate.sourcePageId);
    if (!page) continue;
    counts.set(page.path, (counts.get(page.path) ?? 0) + 1);
  }
  return counts;
}

export function sourceResourceIsAdoptableImage(resource: SourceSnapshotResource) {
  return resource.outcome === "fetched"
    && Boolean(resource.storageKey && resource.blobContentHash && resource.rawContentHash)
    && adoptableImageTypes.has((resource.contentType ?? "").split(";", 1)[0]?.toLowerCase() ?? "");
}

function sourceResourceIsPersistedSvg(resource: SourceSnapshotResource) {
  return resource.outcome === "fetched"
    && Boolean(resource.storageKey && resource.blobContentHash && resource.rawContentHash)
    && (resource.contentType ?? "").split(";", 1)[0]?.trim().toLowerCase() === "image/svg+xml";
}

function sourceAssetCandidate(
  resource: SourceSnapshotResource,
  page: SourceSnapshotPage,
  linkedOtherSiteDomains: ReadonlySet<string>
): SourceAssetCandidate {
  const url = resource.finalUrl ?? resource.requestedUrl;
  const assetUrl = new URL(url);
  const decodedPath = decodeURIComponentSafe(assetUrl.pathname);
  const rawPath = decodedPath.toLowerCase();
  const signal = normalizedSignal(decodedPath);
  const pageSignal = normalizedSignal(`${page.path} ${page.title ?? ""}`);
  const identityPage = page.path === "/" || /\b(?:about|team|company)\b/.test(pageSignal);
  const projectEvidencePage = /\b(?:gallery|portfolio|projects?|remodel|before after|case stud(?:y|ies)|our work)\b/.test(pageSignal);
  const reasons: string[] = [];
  let score = 0;
  let likelyKind: SourceAssetCandidate["likelyKind"] = "other";
  let excludedArtwork = false;
  const firstParty = firstPartyImageHost({
    imageUrl: assetUrl.href,
    pageUrl: page.finalUrl ?? page.requestedUrl,
    linkedOtherSiteDomains
  });

  if (!firstParty) {
    score -= 260;
    reasons.push("cross-origin dependency rather than a first-party asset");
  }
  const pageRole = classifySourcePagePath(page.path);
  if (pageRole !== "customer_content") {
    score -= 190;
    reasons.push("associated with an archive, template, or utility route rather than a customer page");
  }

  if (/\b(?:logo|logomark|brand[-_ ]?mark)\b/.test(signal)) {
    score += 240;
    likelyKind = "logo";
    reasons.push("filename suggests an official brand mark");
  } else if (/\b(?:favicon|apple[-_ ]?touch|android[-_ ]?chrome|icon|sprite)\b/.test(signal)) {
    score -= 180;
    likelyKind = "icon";
      reasons.push("utility icon signal");
  }
  if (/\/(?:accolades?|awards?|associations?|partners?|certifications?|memberships?)\//.test(rawPath)) {
    score -= 420;
    likelyKind = "other";
    excludedArtwork = true;
    reasons.push("award, association, or partner artwork is not the business identity");
  }
  if (/\/common\/scorpion\/|\bpowered[-_ ]?by\b/.test(rawPath)) {
    score -= 420;
    likelyKind = "other";
    excludedArtwork = true;
    reasons.push("site-vendor artwork is not the business identity");
  }
  if (/\b(?:fb|facebook|twitter|linkedin|social)\s+(?:link\s*)?(?:image|preview|share)\b/.test(signal)) {
    score -= 180;
    likelyKind = "other";
    excludedArtwork = true;
    reasons.push("social-sharing preview artwork is not primary page photography");
  }

  if (/\b(?:team|technician|tech|staff|crew|owner|founder|employee|specialist|portrait|headshot)\b/.test(signal)) {
    likelyKind = "photo";
    if (identityPage) {
      score += 190;
      reasons.push("people-oriented filename is supported by a homepage or identity-page association");
    } else {
      reasons.push("people-oriented filename lacks homepage or identity-page support");
    }
  }
  if (/\b(?:truck|vehicle|office|headquarters|shop|uniform|equipment)\b/.test(signal)) {
    likelyKind = "photo";
    if (identityPage) {
      score += 115;
      reasons.push("operations-oriented filename is supported by a homepage or identity-page association");
    } else {
      reasons.push("operations-oriented filename lacks homepage or identity-page support");
    }
  }
  if (/\b(?:service|services)\b/.test(signal)) {
    score += 45;
    if (likelyKind === "other") likelyKind = "photo";
    reasons.push("filename suggests service-relevant photography");
  }
  if (/\/wp-content\/gallery\//.test(rawPath)) {
    score += 85;
    likelyKind = "photo";
    reasons.push("first-party gallery image");
  }
  if (/\/thumbs\/thumbs_[^/]+$/i.test(rawPath)) {
    score -= 55;
    reasons.push("gallery thumbnail derivative");
  }
  if (page.path === "/") {
    score += 100;
    reasons.push("referenced by the source homepage");
  } else if (/\b(?:about|team|company)\b/.test(pageSignal)) {
    score += 45;
    reasons.push("referenced by an identity page");
  } else if (/\bservices?\b/.test(pageSignal)) {
    score += 20;
    reasons.push("referenced by a services page");
  } else if (projectEvidencePage) {
    score += 125;
    likelyKind = "photo";
    reasons.push("referenced by a concrete project, gallery, or case-study page");
  }

  if (!/-\d{2,4}x\d{2,4}(?=\.[a-z0-9]+$)/i.test(rawPath)) {
    score += 25;
    reasons.push("original-size URL");
  }
  const bytes = resource.rawBytes ?? 0;
  if (bytes >= 40_000) score += 20;
  else if (bytes > 0 && bytes < 20_000 && likelyKind !== "logo") {
    score -= 35;
    reasons.push("small file is more likely to be a decorative icon than composition photography");
  }
  if (/\b(?:placeholder|loading|spinner|payment|badge|seal|stars?|avatar-default)\b/.test(signal)) {
    score -= 120;
    excludedArtwork = true;
    reasons.push("generic utility-art signal");
  }
  if (/\b(?:portrait of|side view of|utc)\b/.test(signal) || stockImageSignal(url)) {
    score -= 175;
    reasons.push("filename suggests generic stock photography");
  }
  // A source page can host its photographs on a CDN. This is a visual-review
  // candidate, not an ownership determination or automatic adoption permission.
  if (likelyKind === "other" && pageRole === "customer_content" && !excludedArtwork && bytes >= 20_000) {
    likelyKind = "photo";
    reasons.push("substantial customer-page image; inspect pixels and provenance before adoption");
  }

  return {
    resource,
    sourcePageId: page.id,
    sourcePageUrl: page.finalUrl ?? page.requestedUrl,
    likelyKind,
    firstPartyHost: firstParty,
    relevanceScore: score,
    relevanceReasons: reasons
  };
}

function sourcePageAssociationScore(page: SourceSnapshotPage) {
  const role = classifySourcePagePath(page.path);
  let score = role === "customer_content" ? 1_000 : role === "mechanical_archive" ? 0 : -1_000;
  if (page.path === "/") score += 100;
  else if (/\b(?:about|team|company)\b/.test(normalizedSignal(`${page.path} ${page.title ?? ""}`))) score += 80;
  else if (/\b(?:gallery|portfolio|projects?|remodel|before after|case stud(?:y|ies)|our work)\b/.test(normalizedSignal(`${page.path} ${page.title ?? ""}`))) score += 70;
  else if (/\bservices?\b/.test(normalizedSignal(`${page.path} ${page.title ?? ""}`))) score += 40;
  return score;
}

/**
 * One visual family per image: responsive size variants (`-300x200`, Webflow
 * `-p-800`, `@2x`, WordPress `-scaled`, gallery thumbs, Wix fill/fit/crop transforms
 * and size query parameters) collapse to the same identity.
 */
export function sourceImageFamily(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const path = decodeURIComponentSafe(parsed.pathname)
    .toLowerCase()
    .replace(/\/v\d\/(?:fill|fit|crop)\/.*$/, "")
    .replace(/\/thumbs\/thumbs_([^/]+)$/, "/$1")
    .replace(/(?:-\d{2,5}x\d{2,5}|-p-\d{2,5}|@[23]x|-scaled)+(?=\.[a-z0-9]+$)/, "");
  return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizedSignal(value: string) {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const stockPathPattern = /\b(?:adobe ?stock|shutterstock|istock(?:photo)?|getty ?images|depositphotos|dreamstime|123rf|bigstock|unsplash|pexels|pixabay|freepik|stock ?photo)\b|\/(?:11062b|nsplsh)_/;

/** URL evidence that an image is licensed stock rather than the business's own photograph. */
export function stockImageSignal(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const path = decodeURIComponentSafe(parsed.pathname);
  return isStockOrMarketplaceImageHost(parsed.hostname)
    || stockPathPattern.test(path.toLowerCase())
    || stockPathPattern.test(normalizedSignal(path));
}

/** Photo page roles in the order the author's contact sheets present them. */
export const sourcePhotoPageRoles = ["home", "service", "about", "portfolio", "other"] as const;
export type SourcePhotoPageRole = (typeof sourcePhotoPageRoles)[number];

/**
 * The role of the page a photo was published on. A page the approved site
 * architecture maps to a route and that is not otherwise classified is
 * treated as a service page (e.g. `/ceramic-coating`).
 */
export function sourcePhotoPageRole(path: string, title?: string | null, architectureMapped = false): SourcePhotoPageRole {
  if (path === "/" || path === "") return "home";
  const signal = normalizedSignal(`${path} ${title ?? ""}`);
  if (/\b(?:gallery|portfolio|projects?|remodel|before after|case stud(?:y|ies)|our work)\b/.test(signal)) return "portfolio";
  if (/\b(?:about|team|company|staff|story)\b/.test(signal)) return "about";
  if (/\bservices?\b/.test(signal)) return "service";
  if (architectureMapped && !/\b(?:contact|blog|news|faq|reviews?|testimonials?|privacy|terms|careers?|jobs?)\b/.test(signal)) return "service";
  return "other";
}

/**
 * Plain-language selection notes for one candidate photograph: where it was
 * published, stock evidence and whether its pixels can fill a wide layout.
 * These describe evidence only; the author judges the pixels.
 */
export function sourcePhotoNotes(input: { imageUrl?: string; pagePath?: string; pageTitle?: string; width?: number | null; height?: number | null }) {
  const notes: string[] = [];
  const pageSignal = normalizedSignal(`${input.pagePath ?? ""} ${input.pageTitle ?? ""}`);
  if (input.pagePath === "/") notes.push("published on the source homepage");
  else if (/\b(?:gallery|portfolio|projects?|remodel|before after|case stud(?:y|ies)|our work)\b/.test(pageSignal)) notes.push("published on a project or gallery page");
  else if (/\b(?:about|team|company|staff|story)\b/.test(pageSignal)) notes.push("published on an about or team page");
  else if (/\bservices?\b/.test(pageSignal)) notes.push("published on a service page");
  if (input.imageUrl && stockImageSignal(input.imageUrl)) notes.push("URL indicates licensed stock photography, not this business's own work");
  if (input.width && input.width < 1200) notes.push(`${input.width}x${input.height}: too small for a full-width or hero placement`);
  if (input.width && input.height && input.height > input.width * 1.2) notes.push("portrait orientation");
  return notes;
}
