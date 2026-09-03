import type {
  SourceSnapshotPage,
  SourceSnapshotResource
} from "@/packages/site-contracts";
import { classifySourcePagePath } from "@/packages/business-data/source-page-classification";

export type SourceAssetCandidate = {
  resource: SourceSnapshotResource;
  sourcePageId: string;
  sourcePageUrl: string;
  likelyKind: "logo" | "photo" | "icon" | "other";
  relevanceScore: number;
  relevanceReasons: string[];
};

const adoptableImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export function rankSourceAssetCandidates(input: {
  resources: SourceSnapshotResource[];
  pages: SourceSnapshotPage[];
}) {
  const pagesByUrl = new Map<string, SourceSnapshotPage>();
  for (const page of input.pages) {
    pagesByUrl.set(page.requestedUrl, page);
    if (page.finalUrl) pagesByUrl.set(page.finalUrl, page);
  }
  const strongestByVisualIdentity = new Map<string, SourceAssetCandidate>();
  for (const resource of input.resources) {
    if (!sourceResourceIsAdoptableImage(resource)) continue;
    const sourcePage = resource.initiatorUrls
      .map((url) => pagesByUrl.get(url))
      .filter((page): page is SourceSnapshotPage => Boolean(page))
      .sort((left, right) => sourcePageAssociationScore(right) - sourcePageAssociationScore(left))[0];
    if (!sourcePage) continue;
    const candidate = sourceAssetCandidate(resource, sourcePage);
    const identity = sourceVisualIdentity(resource.finalUrl ?? resource.requestedUrl);
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

export function sourceResourceIsAdoptableImage(resource: SourceSnapshotResource) {
  return resource.outcome === "fetched"
    && Boolean(resource.storageKey && resource.blobContentHash && resource.rawContentHash)
    && adoptableImageTypes.has((resource.contentType ?? "").split(";", 1)[0]?.toLowerCase() ?? "");
}

function sourceAssetCandidate(resource: SourceSnapshotResource, page: SourceSnapshotPage): SourceAssetCandidate {
  const url = resource.finalUrl ?? resource.requestedUrl;
  const assetUrl = new URL(url);
  const rawPath = decodeURIComponentSafe(assetUrl.pathname).toLowerCase();
  const signal = normalizedSignal(rawPath);
  const pageSignal = normalizedSignal(`${page.path} ${page.title ?? ""}`);
  const identityPage = page.path === "/" || /\b(?:about|team|company)\b/.test(pageSignal);
  const projectEvidencePage = /\b(?:gallery|portfolio|projects?|remodel|before after|case stud(?:y|ies)|our work)\b/.test(pageSignal);
  const reasons: string[] = [];
  let score = 0;
  let likelyKind: SourceAssetCandidate["likelyKind"] = "other";
  let excludedArtwork = false;
  const firstParty = assetUrl.hostname.replace(/^www\./, "") === new URL(page.finalUrl ?? page.requestedUrl).hostname.replace(/^www\./, "");

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
  if (/\b(?:service|pest|termite|rodent|roach|ant|mosquito|spider|wildlife|exterminator)\b/.test(signal)) {
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
  if (/\b(?:adobestock|shutterstock|istock|depositphotos|portrait of|side view of|utc)\b/.test(signal)) {
    score -= 175;
    reasons.push("filename suggests generic stock photography");
  }
  if (likelyKind === "other" && firstParty && pageRole === "customer_content" && !excludedArtwork && bytes >= 20_000) {
    likelyKind = "photo";
    reasons.push("substantial first-party customer-page image");
  }

  return {
    resource,
    sourcePageId: page.id,
    sourcePageUrl: page.finalUrl ?? page.requestedUrl,
    likelyKind,
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

function sourceVisualIdentity(url: string) {
  const parsed = new URL(url);
  return `${parsed.hostname.toLowerCase()}${decodeURIComponentSafe(parsed.pathname)
    .toLowerCase()
    .replace(/\/thumbs\/thumbs_([^/]+)$/i, "/$1")
    .replace(/-\d{2,4}x\d{2,4}(?=\.[a-z0-9]+$)/i, "")}`;
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizedSignal(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
