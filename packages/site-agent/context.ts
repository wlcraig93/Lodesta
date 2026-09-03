import type {
  SiteElementSelection,
  SitePublicBuildInput,
  SourceSnapshot,
  SourceSnapshotPage
} from "@/packages/site-contracts";
import { sha256 } from "@/packages/business-data/hash";
import { googleAggregateRatingObservationFromSnapshot } from "@/packages/business-data/web-research";
import type { WorkspaceSourceFile } from "./contracts";
import { trustedAuthoringFonts } from "./font-library";
import { websiteSourceSnapshotPayloadSchema } from "@/packages/site-contracts";
import { classifySourcePagePath, isLegalSourcePagePath, normalizedSourcePagePath } from "@/packages/business-data/source-page-classification";

export type SiteAuthoringContext = {
  schemaVersion: 1;
  kind: "site-authoring-context";
  ownerAuthority: {
    ownerOperationalRevision: number;
    ownerIntentRevision: number;
    ownerConfirmedFacts: SitePublicBuildInput["publicFacts"];
    direction: {
      audience?: string;
      positioning?: string;
      voice: string[];
      primaryConversion: SitePublicBuildInput["intent"]["primaryConversion"];
      brandConstraints: SitePublicBuildInput["intent"]["brandConstraints"];
      enabledCapabilities: SitePublicBuildInput["intent"]["enabledCapabilities"];
      notes: string[];
      pageRequirements: SitePublicBuildInput["intent"]["pageRequirements"];
    };
  };
  publishableBusiness: Omit<SitePublicBuildInput["business"], "assets"> & {
    assets: Array<SitePublicBuildInput["business"]["assets"][number] | AuthoringAssetContext>;
  };
  publicFacts: SitePublicBuildInput["publicFacts"];
  provisionalObservations: {
    googleAggregateRating?: {
      rating: number;
      displayText: string;
      provider: "google";
      observedAt: string;
      sourceSnapshotId: string;
      untrusted: true;
      destination: "not_authorized_unless_present_in_managed_links";
    };
  };
  provisionalSources: Array<{
    id: string;
    sourceType: SourceSnapshot["sourceType"];
    sourceUrl?: string;
    capturedAt: string;
    contentHash: string;
    title?: string;
    contentType: "website" | "research" | "owner_material" | "operator_material";
    provenance: string;
    availability: "available" | "pending" | "unavailable";
    meaningfulExcerpt: string;
    media: {
      referencedUrls: number;
      imageLikeUrls: number;
    };
    untrusted: true;
    websiteInventory?: {
      coverage: "complete" | "restricted" | "incomplete";
      counts: Record<string, number>;
      pathTree: string[];
      pages: Array<{
        id: string;
        path: string;
        title?: string;
        status?: number;
        outcome: SourceSnapshotPage["outcome"];
        canonical?: string;
        indexability: SourceSnapshotPage["indexability"];
        sitemap?: SourceSnapshotPage["sitemap"];
        wordCount: number;
        linkProminence: number;
        exactDuplicateOf?: string;
        templateSignature?: string;
      }>;
      groupings: {
        routePrefixes: Array<{ prefix: string; count: number }>;
        canonicalDuplicates: Array<{ canonical: string; pageIds: string[] }>;
        exactContent: Array<{ contentHash: string; pageIds: string[] }>;
        domTemplates: Array<{ signature: string; pageIds: string[] }>;
        linkCommunities: Array<{ id: string; pageIds: string[]; paths: string[] }>;
      };
    };
  }>;
  managedCapabilities: {
    assets: Array<SitePublicBuildInput["business"]["assets"][number] | AuthoringAssetContext>;
    links: SitePublicBuildInput["business"]["links"];
    forms: SitePublicBuildInput["forms"];
    maps: Array<{ locationId: string; label: string }>;
  };
  designResources: {
    trustedFonts: typeof trustedAuthoringFonts;
  };
};

export type AuthoringAssetContext = Omit<SitePublicBuildInput["business"]["assets"][number], "alt"> & {
  semanticDescriptionStatus: "unverified_until_pixel_inspection";
};

export type ManagerDiscussionContext = {
  schemaVersion: 1;
  kind: "manager-discussion-context";
  instruction: string;
  message: string;
  selection?: SiteElementSelection;
  business: SitePublicBuildInput["business"];
  direction: SiteAuthoringContext["ownerAuthority"]["direction"];
  currentRoutes: string[];
  workspace?: {
    files: Array<{
      path: string;
      contentType: "text/typescript" | "text/tsx" | "text/css";
      bytes: number;
      lines: number;
      contentHash: `sha256:${string}`;
    }>;
  };
};

export function createSiteAuthoringContext(input: {
  buildInput: SitePublicBuildInput;
  snapshots: SourceSnapshot[];
  pages?: SourceSnapshotPage[];
  neutralAssetSemantics?: boolean;
}): SiteAuthoringContext {
  const { buildInput } = input;
  const googleAggregateRating = latestGoogleAggregateRating(input.snapshots);
  const assets = input.neutralAssetSemantics
    ? buildInput.business.assets.map(({ alt: _alt, ...asset }) => ({
        ...asset,
        semanticDescriptionStatus: "unverified_until_pixel_inspection" as const
      }))
    : buildInput.business.assets;
  return {
    schemaVersion: 1,
    kind: "site-authoring-context",
    ownerAuthority: {
      ownerOperationalRevision: buildInput.ownerOperationalRevision,
      ownerIntentRevision: buildInput.ownerIntentRevision,
      ownerConfirmedFacts: buildInput.publicFacts.filter((fact) => fact.source.ownerConfirmed),
      direction: {
        audience: buildInput.intent.audience,
        positioning: buildInput.intent.positioning,
        voice: buildInput.intent.voice,
        primaryConversion: buildInput.intent.primaryConversion,
        brandConstraints: buildInput.intent.brandConstraints,
        enabledCapabilities: buildInput.intent.enabledCapabilities,
        notes: buildInput.intent.notes,
        pageRequirements: buildInput.intent.pageRequirements
      }
    },
    publishableBusiness: { ...buildInput.business, assets },
    publicFacts: buildInput.publicFacts,
    provisionalObservations: {
      ...(googleAggregateRating ? {
        googleAggregateRating: {
          rating: googleAggregateRating.observation.rating,
          displayText: `${googleAggregateRating.observation.rating} stars on Google`,
          provider: "google" as const,
          observedAt: googleAggregateRating.observation.observedAt,
          sourceSnapshotId: googleAggregateRating.snapshot.id,
          untrusted: true as const,
          destination: "not_authorized_unless_present_in_managed_links" as const
        }
      } : {})
    },
    provisionalSources: input.snapshots.map((snapshot) => ({
      id: snapshot.id,
      sourceType: snapshot.sourceType,
      sourceUrl: snapshot.sourceUrl,
      capturedAt: snapshot.capturedAt,
      contentHash: snapshot.contentHash,
      title: sourceTitle(snapshot.payload),
      contentType: sourceContentType(snapshot.sourceType),
      provenance: `${snapshot.sourceType}:${snapshot.sourceUrl ?? snapshot.id}`,
      availability: sourceAvailability(snapshot.payload),
      meaningfulExcerpt: meaningfulSourceExcerpt(snapshot.payload),
      media: sourceMediaMetadata(snapshot.payload),
      untrusted: true,
      websiteInventory: websiteInventory(snapshot, (input.pages ?? []).filter((page) => page.sourceSnapshotId === snapshot.id))
    })),
    managedCapabilities: {
      assets,
      links: buildInput.business.links,
      forms: buildInput.forms,
      maps: buildInput.business.locations.map((location) => ({
        locationId: location.id,
        label: location.label
      }))
    },
    designResources: { trustedFonts: trustedAuthoringFonts }
  };
}

function latestGoogleAggregateRating(snapshots: SourceSnapshot[]) {
  return snapshots.flatMap((snapshot) => {
    const observation = googleAggregateRatingObservationFromSnapshot(snapshot);
    return observation ? [{ snapshot, observation }] : [];
  }).sort((left, right) => (
    Date.parse(right.observation.observedAt) - Date.parse(left.observation.observedAt)
    || right.snapshot.id.localeCompare(left.snapshot.id)
  ))[0];
}

function websiteInventory(snapshot: SourceSnapshot, pages: SourceSnapshotPage[]): SiteAuthoringContext["provisionalSources"][number]["websiteInventory"] {
  const payload = websiteSourceSnapshotPayloadSchema.safeParse(snapshot.payload);
  if (!payload.success) return undefined;
  const grouped = <Key extends string>(keyFor: (page: SourceSnapshotPage) => Key | undefined) => {
    const groups = new Map<Key, string[]>();
    for (const page of pages) {
      const key = keyFor(page);
      if (!key) continue;
      groups.set(key, [...(groups.get(key) ?? []), page.id]);
    }
    return groups;
  };
  const prefixCounts = new Map<string, number>();
  for (const page of pages) {
    const first = page.path.split("/").filter(Boolean)[0];
    const prefix = first ? `/${first}/` : "/";
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }
  const canonical = grouped((page) => page.canonical);
  const exact = grouped((page) => page.rawContentHash);
  const templates = grouped((page) => page.templateSignature);
  const pageByPath = new Map(pages.map((page) => [page.path, page]));
  const parent = new Map(pages.map((page) => [page.id, page.id]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      const root = leftRoot.localeCompare(rightRoot) <= 0 ? leftRoot : rightRoot;
      parent.set(leftRoot, root);
      parent.set(rightRoot, root);
    }
  };
  for (const page of pages) {
    for (const link of page.internalLinks) {
      try {
        const url = new URL(link);
        const target = pageByPath.get(`${url.pathname || "/"}${url.search}`);
        if (target) union(page.id, target.id);
      } catch {
        // The typed crawl manifest normally guarantees valid URLs.
      }
    }
  }
  const communities = new Map<string, SourceSnapshotPage[]>();
  for (const page of pages) communities.set(find(page.id), [...(communities.get(find(page.id)) ?? []), page]);
  return {
    coverage: payload.data.coverage,
    counts: payload.data.counts,
    pathTree: pages.map((page) => page.path).sort(),
    pages: pages.map((page) => ({
      id: page.id,
      path: page.path,
      title: page.title,
      status: page.status,
      outcome: page.outcome,
      canonical: page.canonical,
      indexability: page.indexability,
      sitemap: page.sitemap,
      wordCount: page.wordCount,
      linkProminence: page.linkProminence,
      exactDuplicateOf: page.exactDuplicateOf,
      templateSignature: page.templateSignature
    })),
    groupings: {
      routePrefixes: [...prefixCounts].map(([prefix, count]) => ({ prefix, count })).sort((a, b) => a.prefix.localeCompare(b.prefix)),
      canonicalDuplicates: [...canonical].filter(([, ids]) => ids.length > 1).map(([canonicalUrl, pageIds]) => ({ canonical: canonicalUrl, pageIds })),
      exactContent: [...exact].filter(([, ids]) => ids.length > 1).map(([contentHash, pageIds]) => ({ contentHash, pageIds })),
      domTemplates: [...templates].map(([signature, pageIds]) => ({ signature, pageIds })),
      linkCommunities: [...communities].map(([id, communityPages]) => ({
        id,
        pageIds: communityPages.map((page) => page.id).sort(),
        paths: communityPages.map((page) => page.path).sort()
      })).sort((left, right) => right.pageIds.length - left.pageIds.length || left.id.localeCompare(right.id))
    }
  };
}

export function createManagerDiscussionContext(input: {
  buildInput: SitePublicBuildInput;
  message: string;
  currentFiles?: WorkspaceSourceFile[];
  selection?: SiteElementSelection;
}): ManagerDiscussionContext {
  const files = input.currentFiles ?? [];
  return {
    schemaVersion: 1,
    kind: "manager-discussion-context",
    instruction: "Discuss the requested change without modifying source. Be concise, state what would change, and identify unsupported capability requests. Speak in owner-facing page and section terms.",
    message: input.message,
    selection: input.selection,
    business: input.buildInput.business,
    direction: {
      audience: input.buildInput.intent.audience,
      positioning: input.buildInput.intent.positioning,
      voice: input.buildInput.intent.voice,
      primaryConversion: input.buildInput.intent.primaryConversion,
      brandConstraints: input.buildInput.intent.brandConstraints,
      enabledCapabilities: input.buildInput.intent.enabledCapabilities,
      notes: input.buildInput.intent.notes,
      pageRequirements: input.buildInput.intent.pageRequirements
    },
    currentRoutes: currentWorkspaceRoutes(files),
    workspace: files.length ? {
      files: files.map((file) => ({
        path: file.path,
        contentType: file.path.endsWith(".css")
          ? "text/css" as const
          : file.path.endsWith(".tsx")
            ? "text/tsx" as const
            : "text/typescript" as const,
        bytes: Buffer.byteLength(file.content),
        lines: file.content.split("\n").length,
        contentHash: sha256(file.content)
      }))
    } : undefined
  };
}

export function authoringContextCharacters(context: SiteAuthoringContext) {
  return JSON.stringify(context).length;
}

export function sourceInventorySummary(context: SiteAuthoringContext) {
  const summaries = context.provisionalSources.flatMap((source) => {
    const inventory = source.websiteInventory;
    if (!inventory) return [];
    const fetchedPages = inventory.pages.filter((page) => page.outcome === "fetched");
    const fetchedIndexablePages = fetchedPages.filter((page) => page.indexability === "indexable");
    const pageById = new Map(inventory.pages.map((page) => [page.id, page]));
    const pageByPath = new Map<string, (typeof fetchedIndexablePages)[number]>();
    for (const page of fetchedIndexablePages) {
      const path = normalizedInventoryPath(page.path);
      const current = pageByPath.get(path);
      if (!current || current.exactDuplicateOf && !page.exactDuplicateOf) pageByPath.set(path, page);
    }
    const uniqueIndexablePages = [...pageByPath.values()];
    const contentGroupByPageId = new Map<string, string>();
    for (const group of inventory.groupings.exactContent) {
      for (const pageId of group.pageIds) contentGroupByPageId.set(pageId, group.contentHash);
    }
    const seenContent = new Set<string>();
    const distinctIndexablePages = uniqueIndexablePages.filter((page) => {
      const contentIdentity = contentGroupByPageId.get(page.id) ?? `page:${exactDuplicateRoot(page.id, pageById)}`;
      if (seenContent.has(contentIdentity)) return false;
      seenContent.add(contentIdentity);
      return true;
    });
    const mechanicalArchivePages = distinctIndexablePages.filter((page) => classifySourcePagePath(page.path) === "mechanical_archive");
    const legalPages = distinctIndexablePages.filter((page) => isLegalSourcePagePath(page.path));
    const utilityPages = distinctIndexablePages.filter((page) =>
      classifySourcePagePath(page.path) === "technical_or_utility" && !isLegalSourcePagePath(page.path));
    const customerContentPages = distinctIndexablePages.filter((page) => classifySourcePagePath(page.path) === "customer_content");
    const customerContentCounts = {
      atLeast500: customerContentPages.filter((page) => page.wordCount >= 500).length,
      atLeast1000: customerContentPages.filter((page) => page.wordCount >= 1_000).length,
      words: customerContentPages.reduce((total, page) => total + page.wordCount, 0)
    };
    const duplicateIndexableBodies = uniqueIndexablePages.length - distinctIndexablePages.length;
    const largestPrefixes = [...inventory.groupings.routePrefixes]
      .sort((left, right) => right.count - left.count || left.prefix.localeCompare(right.prefix))
      .slice(0, 8)
      .map((group) => `${group.prefix} (${group.count})`)
      .join(", ");
    const eligible = countFromInventory(inventory.counts, "documentsEligible");
    const fetched = countFromInventory(inventory.counts, "documentsFetched");
    const label = source.sourceUrl ?? source.id;
    return [
      `Website source ${label}: ${inventory.coverage} crawl; ${inventory.pages.length} manifest pages; ${eligible} eligible; ${fetched} fetched; ${uniqueIndexablePages.length} unique fetched indexable paths; ${distinctIndexablePages.length} distinct fetched indexable content bodies after ${duplicateIndexableBodies} duplicate bodies. Content-estate signal: ${customerContentPages.length} likely customer-content paths after separating ${mechanicalArchivePages.length} obvious mechanical archive paths, ${utilityPages.length} technical or site-builder paths, and ${legalPages.length} source-sensitive legal paths; ${customerContentCounts.atLeast500} of those content paths have at least 500 words; ${customerContentCounts.atLeast1000} have at least 1000 words; together they contain ${customerContentCounts.words} words and ${customerContentPages.length} distinct content bodies. These existing authorized first-party content assets are not hypothetical generated keyword pages. Known CMS archive and site-builder routes are strong retirement candidates, not business offerings or design direction. Legal paths are different: preserve their exact paths and substantive provisions without summarizing. The manifest also contains ${inventory.pages.filter((page) => Boolean(page.exactDuplicateOf)).length} exact-duplicate references; largest route prefixes: ${largestPrefixes || "none"}. These are neutral corpus indicators rather than an automatic route target or quality verdict, but every retained source path still requires a deliberate preserved, redirected, canonical-duplicate, or intentionally retired disposition.`
    ];
  });
  return summaries.length
    ? summaries.join("\n")
    : "No retained website crawl inventory is available for this run.";
}

function normalizedInventoryPath(value: string) {
  return normalizedSourcePagePath(value);
}

function exactDuplicateRoot(
  pageId: string,
  pageById: Map<string, { id: string; exactDuplicateOf?: string }>
) {
  let current = pageId;
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const parent = pageById.get(current)?.exactDuplicateOf;
    if (!parent) return current;
    current = parent;
  }
  return [...visited].sort()[0] ?? pageId;
}

function countFromInventory(counts: Record<string, number>, key: string) {
  const value = counts[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function currentWorkspaceRoutes(files: WorkspaceSourceFile[]) {
  const source = files.map((file) => file.content).join("\n");
  return [...source.matchAll(/\bpath\s*:\s*["'](\/[^"']*)["']/g)]
    .map((match) => match[1])
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
}

function sourceContentType(sourceType: SourceSnapshot["sourceType"]) {
  if (sourceType === "website") return "website" as const;
  if (sourceType === "web_research") return "research" as const;
  if (sourceType === "owner_input") return "owner_material" as const;
  return "operator_material" as const;
}

function sourceAvailability(payload: Record<string, unknown>) {
  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "";
  if (status.includes("pending")) return "pending" as const;
  if (status.includes("unavailable") || status.includes("failed") || status.includes("error")) {
    return "unavailable" as const;
  }
  return "available" as const;
}

function sourceTitle(payload: Record<string, unknown>) {
  for (const candidate of [
    payload.title,
    recordValue(payload.metadata)?.title,
    recordValue(payload.page)?.title,
    recordValue(payload.business)?.name
  ]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 240);
  }
  return undefined;
}

function meaningfulSourceExcerpt(payload: Record<string, unknown>) {
  const strings: string[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (strings.join("\n").length >= 2_400 || depth > 5) return;
    if (typeof value === "string") {
      const cleaned = value.replace(/\s+/g, " ").trim();
      if (cleaned.length < 2 || seen.has(cleaned)) return;
      seen.add(cleaned);
      strings.push(cleaned.slice(0, 1_200));
      return;
    }
    if (Array.isArray(value)) {
      for (const nested of value.slice(0, 20)) visit(nested, depth + 1);
      return;
    }
    const record = recordValue(value);
    if (!record) return;
    const priority = ["title", "name", "description", "summary", "text", "content", "body", "address", "hours", "services"];
    const visited = new Set<string>();
    for (const key of priority) {
      if (!(key in record)) continue;
      visited.add(key);
      visit(record[key], depth + 1);
    }
    for (const [key, nested] of Object.entries(record).slice(0, 40)) {
      if (!visited.has(key)) visit(nested, depth + 1);
    }
  };
  visit(payload, 0);
  return strings.join("\n").slice(0, 2_400);
}

function sourceMediaMetadata(payload: Record<string, unknown>) {
  const urls = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || urls.size >= 500) return;
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) urls.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const nested of value) visit(nested, depth + 1);
      return;
    }
    const record = recordValue(value);
    if (!record) return;
    for (const nested of Object.values(record)) visit(nested, depth + 1);
  };
  visit(payload, 0);
  return {
    referencedUrls: urls.size,
    imageLikeUrls: [...urls].filter((url) => /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(url)).length
  };
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
