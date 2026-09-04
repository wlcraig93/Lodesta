import { sha256, stableJson } from "@/packages/business-data";
import {
  isStaticSiteRoutePath,
  siteArchitecturePlanSchema,
  type SiteArchitecturePlan,
  type SiteArchitectureRoute,
  type SourceSnapshotPage
} from "@/packages/site-contracts";
import type { WorkspaceSourceFile } from "./contracts";
import { sourceWorkspaceContentFilePaths } from "./source-workspace";
import { normalizeSiteRedirectPath } from "@/packages/platform-operations/contracts";
import { isLegalSourcePagePath } from "@/packages/business-data/source-page-classification";

export const siteArchitectureModelId = "gpt-5.6-luna" as const;

export type SiteArchitectureInventoryEntry = {
  path: string;
  requestedVariants: number;
  outcomes: string[];
  statuses: number[];
  indexability: string[];
  canonicalPaths: string[];
  title: string | null;
  headings: string[];
  wordCount: number;
  linkProminence: number;
  internalLinkCount: number;
  exactDuplicateOf: string | null;
  evidencePreview: string | null;
};

export type SiteArchitectureAuthorityContext = {
  businessName: string;
  description: string | null;
  locations: Array<{
    label: string;
    city: string | null;
    region: string | null;
    country: string;
  }>;
  serviceAreas: string[];
  offerings: string[];
};

export type RawSiteArchitecturePlan = {
  strategy: string;
  primaryNavigation: Array<{ label: string; path: string }>;
  routes: Array<Omit<SiteArchitectureRoute, "sourcePaths">>;
  sourceDispositions: Record<string, {
    disposition: "preserved" | "redirected" | "canonical_duplicate" | "retired";
    targetPath: string | null;
  }>;
  authoringGuidance: string[];
};

export type SiteArchitectureValidation = ReturnType<typeof validateSiteArchitecturePlan>;

export const siteArchitectureSystemPrompt = `You are Lodesta's information architect for a high-quality redesign of an existing local-business website.

The supplied inventory is exhaustive: it contains every unique path retained from the crawl. Inspect every record before deciding the architecture. You own all substantive judgments about which pages remain distinct, consolidate, redirect, or retire.

Your output must also be mechanically exhaustive:
- Complete the sourceDispositions object supplied by the schema. It is keyed by every source path, so omissions and duplicate source identities are structurally impossible.
- Emit every proposed live route explicitly in routes. Never use a placeholder, wildcard, range, representative route, "remaining pages," or an implied collection.
- If a disposition is preserved, redirected, or canonical_duplicate, targetPath must exactly equal one explicitly declared route path.
- If a disposition is retired, targetPath must be null.
- Never declare a redirected, canonical-duplicate, or retired source path as a live route.
- Never emit the same live route path twice. Lodesta derives each route's source-content mapping from disposition targets, so do not repeat that mapping in routes.
- Use one route convention: root is "/"; every other live route uses lowercase slug segments, contains no query string, and has no trailing slash. A final legacy .html, .htm, .php, .asp, or .aspx extension is allowed when preserving that source URL.
- A preserved source path must remain the same route.
- Preserve distinct, useful, indexable articles and guides as explicit routes. Do not replace a large editorial corpus with generic placeholders.

Improve the architecture rather than blindly mirror it. Distinguish core offerings from location and search-intent labels. Do not create a service-by-location Cartesian product. Keep primary navigation concise even if the crawlable route surface is large. There is no numeric page target.

The supplied owner authority defines the business this site is allowed to represent. A crawl may include a parent brand, franchise network, sibling offices, marketplace, or other locations outside that authority. Treat those pages as migration evidence, not proof that this site owns those businesses or locations. Preserve location-specific routes only when they are represented by the supplied locations or service areas; otherwise redirect useful context to an in-scope hub or retire it.

For every live route, provide one concise purpose sentence describing the distinct customer need that page owns. Use natural, concrete verbs and the actual customer condition or choice; avoid abstract placeholders such as service question, condition question, journey, or next step. This is technical content responsibility, not draft copy or a keyword restatement.

This is architecture only. Do not write page copy, HTML, CSS, or visual design. Keep records terse so there is ample output capacity to enumerate the entire site.`;

/** Operator-only architecture treatment: keep the migration ledger exhaustive while making the live site intentionally useful. */
export const siteArchitectureCommercialCoreSystemPrompt = `You are Lodesta's information architect for a high-quality redesign of an existing local-business website.

The inventory is exhaustive research and migration evidence, not a checklist of pages to recreate. Each evidencePreview is a bounded source sample for judging whether the page owns concrete customer value; it is not draft copy and may omit material elsewhere on the page. Design the smallest coherent live site that fully serves the business: a clear commercial core, supported service and location journeys, company/contact/utility pages, and only genuinely distinct evergreen guides with durable customer value. A large legacy corpus should not by itself produce a large live route surface.

Consolidate or redirect thin, repetitive, keyword-variant, date-stale, archive, tag, author, service-by-location, unsupported-superlative, unsupported-offer, and near-duplicate pages into the best complete customer answer. Retire content only when it is obsolete, wrong-market, mechanically generated, unsupported, or has no useful destination. Preserve a source path as live only when that page owns a distinct substantive customer job. If two proposed routes would use substantially the same opening argument, evidence, and next action, consolidate them unless they answer materially different customer decisions. Every live route must be reachable from concise primary navigation or an explicit hub and must warrant its own customer-facing composition and copy.

A different service or pest label does not by itself justify a separate live route. Preserve a service-detail route only when the evidence supports a distinct customer situation, observable concern, comparison, preparation need, or useful answer beyond replacing the subject noun in one shared page. Treat copied location lists, noun-swapped prose, topic leakage from another service, and repeated calls to action as thin even when the page has a large word count. Redirect those source paths into the strongest truthful service hub or grouped answer before authoring begins.

A distinct article title or search question is not enough to justify a distinct live route. Preserve an individual guide or news route only when the inventory indicates enough first-party depth to support a materially different, useful customer answer with its own opening, substantive middle, and specific next action. Otherwise consolidate the useful material into a curated hub or stronger related answer and redirect the source path. Prefer a smaller complete editorial collection over a large family of shallow pages that would repeat one shell and generic advice.

Do not preserve a reviews, testimonials, team, staff, careers, offer, project, gallery, proof, or city route merely because its URL, headings, or word count exists. Keep it only when the inventory evidence shows enough concrete first-party content to satisfy that exact customer job without unsupported claims or generic meta-advice about what a visitor could ask. A project or gallery route needs identifiable work, places, imagery, or outcomes rather than general statements about the category. A reviews route needs attributable customer feedback rather than an explanation of why reviews matter. Consolidate useful proof into home or about when it does not warrant a complete distinct route. A city name plus generic service availability is not a distinct local answer; consolidate it into the service-area hub unless the source supports meaningful locality-specific guidance.

Do not create a dedicated service-area route from one broad region or state label alone. Keep that fact as a concise homepage or contact cue unless a retained source route contains a substantive local answer or multiple named markets support a useful grouped service-area page.

Treat transactional systems as capability boundaries, not route inventories to reproduce. Lodesta does not rebuild commerce catalogs, carts, checkout, appointment inventory, provider embeds, or third-party review submission as static pages. When the source contains one of those systems, keep a single authored overview or hub only when it serves a distinct customer decision, preserve approved booking, shopping, or review destinations as external link-outs during authoring, and redirect or retire item-detail, cart, checkout, review-submission, and other transaction-only paths. A legacy leave-a-review route is transaction-only: never preserve it as a live authored route that promises a destination the inventory cannot establish; redirect it to a supported company or contact route, or retire it. Any owner-approved external review destination is materialized separately for the author. Never create a static product, appointment-detail, or review-submission route when a visitor cannot complete that transaction on Lodesta. Transactional source pages remain evidence for the overview; they are not independent live-route obligations.

Treat utility systems the same way. Lodesta does not provide authored-site search, so redirect or retire a legacy search route instead of drawing a nonfunctional search box. Preserve a site-map route only when the proposed live architecture is large enough that the index gives visitors meaningful navigation beyond the concise header and explicit hubs. A legacy utility URL is not by itself a customer job.

Existing privacy, terms, cookie, legal, and accessibility pages are source-sensitive owner documents, not ordinary utility content. Preserve each one at its exact source path and carry its substantive source text forward without summarizing, modernizing, or replacing provisions. Design may change; legal meaning may not.

The supplied owner authority is the scope boundary. Source pages for a parent brand, franchise network, sibling branch, marketplace, or location outside that authority are not owned location pages. Preserve a location route only when its place is represented in the supplied locations or service areas. Consolidate useful general service evidence into an in-scope hub and redirect or retire out-of-scope location pages. Never infer a larger operating footprint merely because the crawl reached it.

Write every route purpose as a natural internal customer brief with concrete verbs and the actual condition, comparison, or action. Avoid abstract placeholders such as service question, condition question, preparation question, journey, or next step; those phrases leak into weak customer copy even though the purpose itself is not draft prose.

The sourceDispositions ledger remains mechanically exhaustive: include every inventory path exactly once. Every non-retired targetPath must name an explicitly declared live route; preserved paths keep the same path; retired paths use null. If a live route path already exists in the source inventory, that exact source path must be preserved to itself—never mark a declared live route's source path redirected, canonical_duplicate, or retired. Emit every live route explicitly, never placeholders or wildcards, never duplicate routes, queries, or trailing slashes. Keep one concise customer-need purpose per live route and one concise primary navigation. Do not create service-by-location Cartesian products.

This is architecture only. Do not write page copy, HTML, CSS, or visual design. Keep records terse enough to complete the entire disposition ledger.`;

/** Operator-only treatment that makes the existing purpose field do double duty as a concise authoring handoff. */
export const siteArchitectureCommercialCoreMessageTargetSystemPrompt = `${siteArchitectureCommercialCoreSystemPrompt}

Use each route's existing purpose field as a compact authoring brief, not a generic page description. Name the concrete customer decision or question, the supported service or topic, the market when the inventory supports it, and the intended next action. The homepage purpose should identify the business category, supported market, primary customer path, and conversion action. Prefer direct language such as "Help Triangle homeowners choose the right pest-control service and request an estimate" over abstractions such as "Present services, values, and commitment." Do not draft slogans, headlines, or prose. Also do not draft treatment steps, prevention advice, safety guidance, or claims about how this business performs its work. A service purpose may say "Help customers understand bee-control service and request an estimate" but not "Explain safe bee removal." Keep authoringGuidance limited to route ownership, consolidation, reachability, and other information-architecture decisions; never prescribe factual page content, service methods, proof, timing, safety, or outcomes. Do not introduce a credential, guarantee, price, safety/environmental promise, response time, superlative, or business capability merely because a legacy title mentions it; those claims still require the author's retained-source research and public fact authority. Keep every purpose to one terse sentence.`;

export const siteArchitecturePromptIdentity = `site-architecture@${sha256(stableJson({
  model: siteArchitectureModelId,
  reasoningEffort: "high",
  system: siteArchitectureSystemPrompt,
  schemaVersion: 1
}))}` as const;

export type SiteArchitectureMode = "canonical" | "commercial-core-pull" | "commercial-core-message-target";

export function siteArchitectureSystemPromptFor(mode: SiteArchitectureMode = "canonical") {
  if (mode === "commercial-core-message-target") return siteArchitectureCommercialCoreMessageTargetSystemPrompt;
  return mode === "commercial-core-pull" ? siteArchitectureCommercialCoreSystemPrompt : siteArchitectureSystemPrompt;
}

export function siteArchitecturePromptIdentityFor(mode: SiteArchitectureMode = "canonical") {
  if (mode === "canonical") return siteArchitecturePromptIdentity;
  return `site-architecture@${sha256(stableJson({
    model: siteArchitectureModelId,
    reasoningEffort: "high",
    system: siteArchitectureSystemPromptFor(mode),
    schemaVersion: 1
  }))}` as const;
}

export function buildSiteArchitectureInventory(pages: SourceSnapshotPage[]): SiteArchitectureInventoryEntry[] {
  const pagePathById = new Map(pages.map((page) => [page.id, canonicalPathname(page.path)]));
  const fetchedPages = pages.filter((page) => page.outcome === "fetched" && Boolean(page.extractedText));
  const evidencePageByPath = new Map<string, SourceSnapshotPage>();
  const lineFrequency = new Map<string, number>();
  for (const page of fetchedPages) {
    const path = canonicalPathname(page.path);
    const current = evidencePageByPath.get(path);
    if (!current || page.wordCount > current.wordCount) evidencePageByPath.set(path, page);
    for (const line of new Set(lines(page.extractedText).map(normalizeLine).filter(Boolean))) {
      lineFrequency.set(line, (lineFrequency.get(line) ?? 0) + 1);
    }
  }
  const byPath = new Map<string, SiteArchitectureInventoryEntry>();
  for (const page of pages) {
    const path = canonicalPathname(page.path);
    const canonicalPath = page.canonical ? canonicalPathname(new URL(page.canonical).pathname) : undefined;
    const normalized: SiteArchitectureInventoryEntry = {
      path,
      requestedVariants: 1,
      outcomes: [page.outcome],
      statuses: page.status ? [page.status] : [],
      indexability: [page.indexability],
      canonicalPaths: canonicalPath ? [canonicalPath] : [],
      title: page.title?.trim() || null,
      headings: page.headings.slice(0, 24),
      wordCount: page.wordCount,
      linkProminence: page.linkProminence,
      internalLinkCount: page.internalLinks.length,
      exactDuplicateOf: page.exactDuplicateOf ? pagePathById.get(page.exactDuplicateOf) ?? null : null,
      evidencePreview: null
    };
    const current = byPath.get(path);
    if (!current) {
      byPath.set(path, normalized);
      continue;
    }
    const richer = normalized.wordCount > current.wordCount ? normalized : current;
    byPath.set(path, {
      ...richer,
      path,
      requestedVariants: current.requestedVariants + 1,
      outcomes: uniqueSorted([...current.outcomes, ...normalized.outcomes]),
      statuses: [...new Set([...current.statuses, ...normalized.statuses])].sort((left, right) => left - right),
      indexability: uniqueSorted([...current.indexability, ...normalized.indexability]),
      canonicalPaths: uniqueSorted([...current.canonicalPaths, ...normalized.canonicalPaths]),
      headings: [...new Set([...current.headings, ...normalized.headings])].slice(0, 24),
      wordCount: Math.max(current.wordCount, normalized.wordCount),
      linkProminence: Math.max(current.linkProminence, normalized.linkProminence),
      internalLinkCount: Math.max(current.internalLinkCount, normalized.internalLinkCount),
      exactDuplicateOf: richer.exactDuplicateOf
    });
  }
  return [...byPath.values()]
    .map((entry) => {
      const page = evidencePageByPath.get(entry.path);
      return {
        ...entry,
        evidencePreview: page ? retainedEvidencePreview(page, lineFrequency, {
          authorDigest: true,
          includeTestimonials: true
        }) || null : null
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function siteArchitectureInventoryHash(inventory: SiteArchitectureInventoryEntry[]) {
  return sha256(stableJson(inventory));
}

export function siteArchitectureUserPrompt(
  inventory: SiteArchitectureInventoryEntry[],
  authority?: SiteArchitectureAuthorityContext
) {
  const authoritySection = authority
    ? `Owner authority (the allowed business and geographic scope):\n${JSON.stringify(authority)}\n\n`
    : "";
  return `${authoritySection}Produce the complete explicit architecture for this ${inventory.length}-path source inventory. Before responding, verify internally that every source path appears exactly once and every non-null target is present in the explicit route list.\n\n${JSON.stringify(inventory)}`;
}

export function siteArchitectureOutputJsonSchema(inventory: SiteArchitectureInventoryEntry[]) {
  // Keep the structured-output grammar deliberately simple. The provider has
  // repeatedly terminated otherwise-valid exhaustive plans after ~500 tokens
  // when this same route regexp is expanded across every disposition. The
  // parsed plan still passes isStaticSiteRoutePath below before it can become
  // retained authority or reach authoring, so this changes generation grammar,
  // not the deterministic route-safety boundary.
  const liveRoutePath = {
    type: "string"
  } as const;
  return {
    type: "object",
    additionalProperties: false,
    required: ["strategy", "primaryNavigation", "routes", "sourceDispositions", "authoringGuidance"],
    properties: {
      strategy: { type: "string" },
      primaryNavigation: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "path"],
          properties: { label: { type: "string" }, path: liveRoutePath }
        }
      },
      routes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "label", "purpose", "pageType", "parentPath", "navigation"],
          properties: {
            path: liveRoutePath,
            label: { type: "string" },
            purpose: { type: "string" },
            pageType: { type: "string" },
            parentPath: { ...liveRoutePath, type: ["string", "null"] },
            navigation: { type: "string", enum: ["primary", "footer", "contextual", "none"] }
          }
        }
      },
      sourceDispositions: {
        type: "object",
        additionalProperties: false,
        required: inventory.map((page) => page.path),
        properties: Object.fromEntries(inventory.map((page) => [page.path, {
          type: "object",
          additionalProperties: false,
          required: ["disposition", "targetPath"],
          properties: {
            disposition: {
              type: "string",
              enum: isLegalSourcePagePath(page.path)
                ? ["preserved"]
                : ["preserved", "redirected", "canonical_duplicate", "retired"]
            },
            targetPath: isLegalSourcePagePath(page.path)
              ? { type: "string", const: page.path }
              : { ...liveRoutePath, type: ["string", "null"] }
          }
        }]))
      },
      authoringGuidance: { type: "array", items: { type: "string" } }
    }
  } as const;
}

/**
 * Lossless bookkeeping normalization only. The model owns every consolidation
 * and retirement decision; this step makes its explicit target ledger internally
 * representable without adding a critic or a second model request.
 */
export function normalizeSiteArchitecturePlan(
  raw: RawSiteArchitecturePlan,
  inventory: SiteArchitectureInventoryEntry[]
) {
  const sourceDispositions: SiteArchitecturePlan["sourceDispositions"] = inventory.map(({ path }) => ({
    sourcePath: path,
    ...raw.sourceDispositions[path]
  }));
  const routes: SiteArchitecturePlan["routes"] = [];
  const routeIndex = new Map<string, number>();
  for (const route of raw.routes) {
    if (routeIndex.has(route.path)) continue;
    routeIndex.set(route.path, routes.length);
    routes.push({ ...route, sourcePaths: [] });
  }

  // "Preserved" already makes the target unambiguous: the source remains at
  // its exact path. Normalize a redundant null instead of rejecting an
  // otherwise complete model-authored ledger. Redirect and retirement targets
  // remain strict because filling those would require a substantive decision.
  for (const item of sourceDispositions) {
    if (item.disposition === "preserved" && item.targetPath === null) {
      item.targetPath = item.sourcePath;
    }
  }

  const initialRoutePaths = new Set(routes.map((route) => route.path));
  const targetedPaths = new Set(sourceDispositions.flatMap((item) =>
    item.disposition !== "retired" && item.targetPath ? [item.targetPath] : []
  ));
  // A ledger destination is necessarily live, including when the model relies
  // on normalization to materialize that route. Its own retained path cannot
  // simultaneously redirect elsewhere without making the ledger impossible.
  for (const item of sourceDispositions) {
    if (!targetedPaths.has(item.sourcePath) || item.disposition === "preserved") continue;
    item.disposition = "preserved";
    item.targetPath = item.sourcePath;
  }
  const removedPaths = new Set<string>();
  for (const item of sourceDispositions) {
    if (item.disposition === "preserved" || !initialRoutePaths.has(item.sourcePath)) continue;
    if (item.targetPath === item.sourcePath || targetedPaths.has(item.sourcePath)) {
      item.disposition = "preserved";
      item.targetPath = item.sourcePath;
    } else {
      removedPaths.add(item.sourcePath);
    }
  }

  const normalizedRoutes = routes
    .filter((route) => !removedPaths.has(route.path))
    .map((route) => ({
      ...route,
      parentPath: route.parentPath && removedPaths.has(route.parentPath)
        ? sourceDispositions.find((item) => item.sourcePath === route.parentPath)?.targetPath ?? null
        : route.parentPath,
      sourcePaths: sourceDispositions
        .filter((item) => item.disposition !== "retired" && item.targetPath === route.path)
        .map((item) => item.sourcePath)
    }));
  const normalizedRoutePaths = new Set(normalizedRoutes.map((route) => route.path));
  for (const targetPath of targetedPaths) {
    if (normalizedRoutePaths.has(targetPath)) continue;
    const mappedSources = sourceDispositions
      .filter((item) => item.disposition !== "retired" && item.targetPath === targetPath)
      .map((item) => item.sourcePath);
    const representative = inventory.find((item) => item.path === targetPath)
      ?? mappedSources.map((path) => inventory.find((item) => item.path === path)).filter(isPresent)
        .sort((left, right) => right.wordCount - left.wordCount)[0];
    const label = representative?.title?.trim() || representative?.headings[0]?.trim() || titleFromPath(targetPath);
    normalizedRoutes.push({
      path: targetPath,
      label,
      purpose: `Give visitors a useful, source-grounded answer about ${label}.`,
      pageType: "source-page",
      parentPath: null,
      navigation: "none",
      sourcePaths: mappedSources
    });
    normalizedRoutePaths.add(targetPath);
  }

  const primaryNavigation = raw.primaryNavigation
    .map((item) => {
      if (!removedPaths.has(item.path)) return item;
      const targetPath = sourceDispositions.find((source) => source.sourcePath === item.path)?.targetPath;
      return targetPath ? { ...item, path: targetPath } : null;
    })
    .filter((item): item is SiteArchitecturePlan["primaryNavigation"][number] => Boolean(item && normalizedRoutePaths.has(item.path)))
    .filter((item, index, values) => values.findIndex((candidate) => candidate.path === item.path) === index);

  return siteArchitecturePlanSchema.parse({
    ...raw,
    primaryNavigation,
    routes: normalizedRoutes,
    sourceDispositions
  });
}

export function validateSiteArchitecturePlan(
  inventory: SiteArchitectureInventoryEntry[],
  plan: SiteArchitecturePlan
) {
  const sourcePaths = new Set(inventory.map((page) => page.path));
  const dispositionCounts = new Map<string, number>();
  const unknownDispositionPaths: string[] = [];
  for (const item of plan.sourceDispositions) {
    dispositionCounts.set(item.sourcePath, (dispositionCounts.get(item.sourcePath) ?? 0) + 1);
    if (!sourcePaths.has(item.sourcePath)) unknownDispositionPaths.push(item.sourcePath);
  }
  const missingDispositionPaths = [...sourcePaths].filter((path) => !dispositionCounts.has(path));
  const duplicateDispositionPaths = [...dispositionCounts.entries()].filter(([, count]) => count > 1).map(([path]) => path);
  const routeCounts = new Map<string, number>();
  for (const route of plan.routes) routeCounts.set(route.path, (routeCounts.get(route.path) ?? 0) + 1);
  const routePaths = new Set(routeCounts.keys());
  const duplicateRoutePaths = [...routeCounts.entries()].filter(([, count]) => count > 1).map(([path]) => path);
  const malformedRoutePaths = [...routePaths].filter((path) => !isStaticSiteRoutePath(path));
  const invalidTargets = plan.sourceDispositions.flatMap((item) => {
    if (item.disposition === "retired") {
      return item.targetPath === null ? [] : [{ sourcePath: item.sourcePath, targetPath: item.targetPath, reason: "retired_has_target" }];
    }
    return item.targetPath && routePaths.has(item.targetPath)
      ? []
      : [{ sourcePath: item.sourcePath, targetPath: item.targetPath, reason: "target_not_live" }];
  });
  const nonLiveSourceConflicts = plan.sourceDispositions.flatMap((item) =>
    item.disposition !== "preserved" && routePaths.has(item.sourcePath)
      ? [{ sourcePath: item.sourcePath, disposition: item.disposition }]
      : []
  );
  const preservedPathChanges = plan.sourceDispositions.flatMap((item) =>
    item.disposition === "preserved" && item.targetPath !== item.sourcePath
      ? [{ sourcePath: item.sourcePath, targetPath: item.targetPath }]
      : []
  );
  const unknownRouteSources = plan.routes.flatMap((route) =>
    route.sourcePaths.filter((path) => !sourcePaths.has(path)).map((sourcePath) => ({ routePath: route.path, sourcePath }))
  );
  const invalidNavigationTargets = plan.primaryNavigation.map((item) => item.path).filter((path) => !routePaths.has(path));
  const missingRoutePurposes = plan.routes.filter((route) => route.purpose.trim().length < 12).map((route) => route.path);
  const unsafeLegalDispositions = plan.sourceDispositions.flatMap((item) =>
    isLegalSourcePagePath(item.sourcePath)
      && (item.disposition !== "preserved" || item.targetPath !== item.sourcePath)
      ? [{ sourcePath: item.sourcePath, disposition: item.disposition, targetPath: item.targetPath }]
      : []
  );
  return {
    complete: !missingDispositionPaths.length
      && !duplicateDispositionPaths.length
      && !unknownDispositionPaths.length
      && !duplicateRoutePaths.length
      && !malformedRoutePaths.length
      && !invalidTargets.length
      && !nonLiveSourceConflicts.length
      && !preservedPathChanges.length
      && !unknownRouteSources.length
      && !invalidNavigationTargets.length
      && !missingRoutePurposes.length
      && !unsafeLegalDispositions.length,
    accountedPaths: inventory.length - missingDispositionPaths.length,
    missingDispositionPaths,
    duplicateDispositionPaths,
    unknownDispositionPaths,
    duplicateRoutePaths,
    malformedRoutePaths,
    invalidTargets,
    nonLiveSourceConflicts,
    preservedPathChanges,
    unknownRouteSources,
    invalidNavigationTargets,
    missingRoutePurposes,
    unsafeLegalDispositions
  };
}

export function createArchitectureReleasePlan(
  plan: SiteArchitecturePlan,
  input: { browserCoverage?: "all-routes" } = {}
) {
  const redirectableDispositions = plan.sourceDispositions.filter((item): item is typeof item & { targetPath: string } => (
    (item.disposition === "redirected" || item.disposition === "canonical_duplicate")
    && Boolean(item.targetPath)
  ));
  const unsafeRedirectSources = new Set(redirectableDispositions.flatMap((item) => {
    try {
      normalizeSiteRedirectPath(item.sourcePath);
      normalizeSiteRedirectPath(item.targetPath);
      return [];
    } catch {
      return [item.sourcePath];
    }
  }));
  return {
    routePaths: plan.routes.map((route) => route.path),
    browserRoutePaths: selectArchitectureBrowserRoutes(plan.routes, input.browserCoverage),
    visualReviewRoutePaths: selectArchitectureVisualReviewRoutes(plan.routes),
    redirects: redirectableDispositions.flatMap((item) =>
      !unsafeRedirectSources.has(item.sourcePath)
        ? [{
            sourcePath: item.sourcePath,
            destinationPath: item.targetPath,
            reason: item.disposition === "canonical_duplicate"
              ? "Canonical duplicate consolidated into the approved live route."
              : "Approved architecture consolidation."
          }]
        : []
    ),
    retiredSourcePaths: plan.sourceDispositions.flatMap((item) =>
      item.disposition === "retired" || unsafeRedirectSources.has(item.sourcePath)
        ? [{ sourcePath: item.sourcePath, reason: "Approved architecture retirement." }]
        : []
    )
  };
}

/**
 * Select a small author-facing evidence set that can reveal route-family
 * repetition. The architecture already records parent/child relationships,
 * so retain that judgment instead of trying to reconstruct families from
 * finalized titles or URL words later.
 */
function selectArchitectureVisualReviewRoutes(routes: SiteArchitectureRoute[]) {
  const selected = new Set<string>();
  const add = (route: SiteArchitectureRoute | undefined) => {
    if (route) selected.add(route.path);
  };
  const routeIndex = new Map(routes.map((route, index) => [route.path, index]));
  const home = routes.find((route) => route.path === "/")
    ?? routes.find((route) => normalizeArchitecturePageType(route.pageType) === "home")
    ?? routes[0];
  add(home);

  const childrenByParent = new Map<string, SiteArchitectureRoute[]>();
  for (const route of routes) {
    // Root-parented routes are the site's top-level collection, not a
    // comparable content family. Prefer a real nested family such as one
    // service hub and its detail routes.
    if (!route.parentPath || route.parentPath === "/" || route.parentPath === route.path) continue;
    const siblings = childrenByParent.get(route.parentPath) ?? [];
    siblings.push(route);
    childrenByParent.set(route.parentPath, siblings);
  }
  const siblingFamily = [...childrenByParent.entries()]
    .filter(([, children]) => children.length >= 2)
    .sort(([leftParent, left], [rightParent, right]) =>
      right.length - left.length
      || (routeIndex.get(leftParent) ?? Number.MAX_SAFE_INTEGER) - (routeIndex.get(rightParent) ?? Number.MAX_SAFE_INTEGER)
      || leftParent.localeCompare(rightParent)
    )[0];

  if (siblingFamily) {
    const [parentPath, children] = siblingFamily;
    add(routes.find((route) => route.path === parentPath));
    add(children[0]);
    add(children[1]);
  } else {
    const comparable = routes
      .filter((route) => route !== home && isMaterialArchitecturePageType(route.pageType))
      .sort((left, right) =>
        normalizeArchitecturePageType(left.pageType).localeCompare(normalizeArchitecturePageType(right.pageType))
        || (routeIndex.get(left.path) ?? 0) - (routeIndex.get(right.path) ?? 0)
      );
    add(comparable[0]);
    add(comparable.find((route) =>
      route !== comparable[0]
      && normalizeArchitecturePageType(route.pageType) === normalizeArchitecturePageType(comparable[0]?.pageType ?? "")
    ) ?? comparable[1]);
  }

  add(routes.find((route) => normalizeArchitecturePageType(route.pageType).includes("contact"))
    ?? routes.find((route) => /(?:^|\/)contact(?:-us)?(?:\.[a-z0-9]+)?$/.test(route.path)));

  for (const routePath of selectArchitectureBrowserRoutes(routes)) {
    if (selected.size >= 5) break;
    add(routes.find((route) => route.path === routePath));
  }
  return [...selected].slice(0, 5);
}

function normalizeArchitecturePageType(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isMaterialArchitecturePageType(value: string) {
  const normalized = normalizeArchitecturePageType(value);
  return !/(?:^|-)(?:home|contact|company|about|utility|legal|privacy|terms|image-credit)(?:-|$)/.test(normalized);
}

const approvedArchitectureModulePrefix = "export const approvedArchitecture = ";
const approvedArchitectureModuleSuffix = " as const;\n";

/**
 * Recovers the immutable model-authored route ledger from the exact evidence
 * module emitted for the retained workspace. This deliberately parses JSON
 * rather than executing workspace TypeScript.
 */
export function parseApprovedArchitectureModule(content: string): SiteArchitecturePlan | undefined {
  if (!content.startsWith(approvedArchitectureModulePrefix) || !content.endsWith(approvedArchitectureModuleSuffix)) {
    return undefined;
  }
  const json = content.slice(approvedArchitectureModulePrefix.length, -approvedArchitectureModuleSuffix.length);
  try {
    return siteArchitecturePlanSchema.parse(JSON.parse(json));
  } catch {
    return undefined;
  }
}

export function createArchitectureEvidenceFiles(
  pages: SourceSnapshotPage[],
  plan: SiteArchitecturePlan,
  input: { retainedContentMode?: "embedded" | "pull" | "indexed-pull" | "indexed-pull-preview" | "indexed-pull-preview-readable" | "indexed-pull-preview-author-digest" } = {}
): WorkspaceSourceFile[] {
  const architectureModule = `${approvedArchitectureModulePrefix}${JSON.stringify(plan)}${approvedArchitectureModuleSuffix}`;
  if (input.retainedContentMode === "pull") {
    return [{ path: "src/approved-architecture.ts", content: architectureModule }];
  }
  if (
    input.retainedContentMode === "indexed-pull"
    || input.retainedContentMode === "indexed-pull-preview"
    || input.retainedContentMode === "indexed-pull-preview-readable"
    || input.retainedContentMode === "indexed-pull-preview-author-digest"
  ) {
    const sourceIndex = createApprovedSourceIndex(pages, plan, {
      includePreviews: input.retainedContentMode !== "indexed-pull",
      authorDigest: input.retainedContentMode === "indexed-pull-preview-author-digest",
      // The readable index is the canonical workspace author's evidence map.
      // Give it enough substantive source context to support a real page
      // argument while keeping the shorter historical/digest variants bounded.
      previewCharacters: input.retainedContentMode === "indexed-pull-preview-readable" ? 1_400 : undefined,
      previewLines: input.retainedContentMode === "indexed-pull-preview-readable" ? 8 : undefined
    });
    return [
      { path: "src/approved-architecture.ts", content: architectureModule },
      {
        path: "src/approved-source-index.ts",
        content: `export const approvedSourceIndex = ${JSON.stringify(
          sourceIndex,
          null,
          input.retainedContentMode === "indexed-pull-preview-readable"
            || input.retainedContentMode === "indexed-pull-preview-author-digest"
            ? 2
            : undefined
        )} as const;\n`
      }
    ];
  }
  const retainedContent = createRetainedContent(pages, plan);
  return [
    { path: "src/approved-architecture.ts", content: architectureModule },
    ...createRetainedContentFiles(retainedContent)
  ];
}

function createApprovedSourceIndex(
  pages: SourceSnapshotPage[],
  plan: SiteArchitecturePlan,
  input: {
    includePreviews?: boolean;
    authorDigest?: boolean;
    previewCharacters?: number;
    previewLines?: number;
  } = {}
) {
  const bestByPath = new Map<string, SourceSnapshotPage>();
  for (const page of pages) {
    const path = canonicalPathname(page.path);
    if (page.outcome !== "fetched" || !page.extractedText) continue;
    const current = bestByPath.get(path);
    if (!current || page.wordCount > current.wordCount) bestByPath.set(path, page);
  }
  const retainedPages = [...bestByPath.values()];
  const lineFrequency = new Map<string, number>();
  if (input.includePreviews) {
    for (const page of retainedPages) {
      const uniqueLines = new Set(lines(page.extractedText).map(normalizeLine).filter(Boolean));
      for (const line of uniqueLines) lineFrequency.set(line, (lineFrequency.get(line) ?? 0) + 1);
    }
  }
  const routes = plan.routes.map((route) => {
    const sources = route.sourcePaths.flatMap((sourcePath) => {
      const page = bestByPath.get(canonicalPathname(sourcePath));
      if (!page) return [];
      return [{
        sourcePath,
        sourceRouteRole: canonicalPathname(sourcePath) === route.path
          ? "approved_live_route" as const
          : "consolidated_evidence_only" as const,
        approvedLinkPath: route.path,
        title: page.title ?? "",
        headings: page.headings.slice(0, 24),
        wordCount: page.wordCount,
        sourcePageId: page.id,
        contentFiles: sourceWorkspaceContentFilePaths(page)
      }];
    });
    const evidencePreviews = input.includePreviews
      ? route.sourcePaths
          .flatMap((sourcePath) => {
            const page = bestByPath.get(canonicalPathname(sourcePath));
            return page ? [{ sourcePath, page }] : [];
          })
          .sort((left, right) =>
            Number(right.sourcePath === route.path) - Number(left.sourcePath === route.path)
            || Number(sourcePageCarriesCustomerProof(right.sourcePath, right.page)) - Number(sourcePageCarriesCustomerProof(left.sourcePath, left.page))
            || right.page.wordCount - left.page.wordCount
            || right.page.linkProminence - left.page.linkProminence
            || left.sourcePath.localeCompare(right.sourcePath)
          )
          .flatMap(({ sourcePath, page }) => {
            const preview = retainedEvidencePreview(page, lineFrequency, {
              authorDigest: input.authorDigest,
              includeTestimonials: sourcePageCarriesCustomerProof(sourcePath, page),
              maxCharacters: input.previewCharacters,
              maxLines: input.previewLines
            });
            return preview ? [{
              sourcePath,
              sourceRouteRole: canonicalPathname(sourcePath) === route.path
                ? "approved_live_route" as const
                : "consolidated_evidence_only" as const,
              approvedLinkPath: route.path,
              sourcePageId: page.id,
              preview
            }] : [];
          })
          .slice(0, 2)
      : undefined;
    const previewSourcePaths = new Set((evidencePreviews ?? []).map((preview) => preview.sourcePath));
    const indexedSources = input.authorDigest
      ? sources
          .filter((source) => previewSourcePaths.has(source.sourcePath))
          .map((source) => ({
            sourcePath: source.sourcePath,
            sourceRouteRole: source.sourceRouteRole,
            approvedLinkPath: source.approvedLinkPath,
            title: source.title,
            sourcePageId: source.sourcePageId,
            contentFiles: source.contentFiles
          }))
      : sources;
    return {
      routePath: route.path,
      label: route.label,
      pageType: route.pageType,
      parentRoutePath: route.parentPath,
      navigation: route.navigation,
      purpose: route.purpose,
      sources: indexedSources,
      ...(evidencePreviews ? { evidencePreviews } : {})
    };
  });
  const sourceSensitiveDocuments = plan.routes.flatMap((route) => route.sourcePaths.flatMap((sourcePath) => {
    if (!isLegalSourcePagePath(sourcePath)) return [];
    const page = bestByPath.get(canonicalPathname(sourcePath));
    if (!page) return [];
    return [{
      routePath: route.path,
      sourcePath,
      title: page.title ?? "",
      wordCount: page.wordCount,
      contentFiles: sourceWorkspaceContentFilePaths(page)
    }];
  })).sort((left, right) => left.routePath.localeCompare(right.routePath) || left.sourcePath.localeCompare(right.sourcePath));
  const routeSourceFiles = plan.routes.map((route) => ({
    routePath: route.path,
    pageType: route.pageType,
    files: route.sourcePaths.flatMap((sourcePath) => {
      const page = bestByPath.get(canonicalPathname(sourcePath));
      return page ? sourceWorkspaceContentFilePaths(page) : [];
    })
  }));
  return {
    liveRoutePaths: plan.routes.map((route) => route.path),
    primaryNavigation: plan.primaryNavigation,
    sourceSensitiveDocuments,
    routeSourceFiles,
    routes
  };
}

function sourcePageCarriesCustomerProof(sourcePath: string, page: SourceSnapshotPage) {
  const explicitProofIdentity = /\b(?:reviews?|testimonials?|customer stor(?:y|ies)|success stor(?:y|ies)|case stud(?:y|ies))\b/i.test(
    `${sourcePath} ${page.title ?? ""}`
  );
  if (explicitProofIdentity) return true;

  // A homepage can legitimately carry its own review module. Other source pages
  // frequently repeat that module's heading as site chrome, so using headings
  // for every route makes nearly the entire crawl look like customer proof and
  // buries the actual review source in the bounded author digest.
  return canonicalPathname(sourcePath) === "/"
    && /\b(?:reviews?|testimonials?|happy customers?)\b/i.test(page.headings.join(" "));
}

function retainedEvidencePreview(
  page: SourceSnapshotPage,
  lineFrequency: Map<string, number>,
  input: {
    authorDigest?: boolean;
    includeTestimonials?: boolean;
    maxCharacters?: number;
    maxLines?: number;
  } = {}
) {
  if (input.includeTestimonials) {
    const testimonialPreview = retainedTestimonialPairPreview(page, {
      maxCharacters: input.maxCharacters ?? 700,
      maxLines: input.maxLines ?? 4
    });
    if (testimonialPreview) return testimonialPreview;
  }
  const candidates: Array<{ index: number; line: string; score: number; shortAttribution: boolean }> = [];
  for (const [lineIndex, rawLine] of lines(page.extractedText).entries()) {
    // Extractors commonly collapse an entire article or testimonial into one
    // paragraph. Sentence segmentation keeps those source-rich pages visible
    // in the bounded preview instead of dropping the line at the length cap.
    const previewLines = previewSegments(rawLine);
    for (const [segmentIndex, line] of previewLines.entries()) {
      const index = lineIndex * 100 + segmentIndex;
      const normalized = normalizeLine(line);
      const shortAttribution = Boolean(input.includeTestimonials && isLikelyTestimonialAttribution(line));
      if (!normalized || (!shortAttribution && line.length < 45) || line.length > 420) continue;
      // A named reviewer is often repeated by a legitimate testimonial module
      // across the crawl. On an explicit proof source, retain the attribution
      // even when the ordinary chrome-frequency filter would discard it.
      if (!shortAttribution && (lineFrequency.get(normalized) ?? 0) >= 3) continue;
      if (/^(?:https?:\/\/|follow\b|read more\b|navigate\b|home\b|customer login\b|call now\b|contact us\b)/i.test(line)) continue;
      if (/^(?:[A-Z0-9&'’ -]{20,})$/.test(line)) continue;
      if (containsGatedBusinessClaim(line)) continue;
      if (input.authorDigest && isLowSignalAuthorDigestLine(line, {
        includeTestimonials: input.includeTestimonials
      })) continue;
      if (candidates.some((current) => normalizeLine(current.line) === normalized)) continue;
      candidates.push({ index, line, score: input.authorDigest ? authorDigestLineScore(line) : -index, shortAttribution });
    }
  }
  const ranked = input.authorDigest
    ? candidates.sort((left, right) => right.score - left.score || left.index - right.index)
    : candidates;
  const selected: Array<{ index: number; line: string }> = [];
  const maxCharacters = input.maxCharacters ?? 700;
  const maxLines = input.maxLines ?? 4;
  let totalCharacters = 0;
  for (const candidate of ranked) {
    const remaining = maxCharacters - totalCharacters;
    if (remaining < 4) break;
    const line = truncatePreviewLine(candidate.line, remaining);
    if (!candidate.shortAttribution && line.length < 45) continue;
    selected.push({ index: candidate.index, line });
    totalCharacters += line.length + 1;
    if (selected.length >= maxLines || totalCharacters >= maxCharacters) break;
  }
  return selected.sort((left, right) => left.index - right.index).map((candidate) => candidate.line).join(" ").trim();
}

function retainedTestimonialPairPreview(
  page: SourceSnapshotPage,
  input: { maxCharacters: number; maxLines: number }
) {
  const sourceLines = lines(page.extractedText);
  const pairs: string[] = [];
  let totalCharacters = 0;
  const maximumPairs = Math.max(1, Math.min(2, Math.floor(input.maxLines / 2)));
  for (let index = 1; index < sourceLines.length && pairs.length < maximumPairs; index += 1) {
    const attribution = sourceLines[index]!;
    if (!isLikelyTestimonialAttribution(attribution)) continue;
    const sourceExcerpt = sourceLines[index - 1]!;
    if (sourceExcerpt.length < 45 || isLikelyTestimonialAttribution(sourceExcerpt)) continue;
    if (/^(?:https?:\/\/|follow\b|read more\b|navigate\b|home\b|customer login\b|call now\b|contact us\b)/i.test(sourceExcerpt)) continue;
    if (containsGatedBusinessClaim(sourceExcerpt)) continue;
    const separator = `\n— ${attribution}`;
    const remaining = input.maxCharacters - totalCharacters;
    const excerptBudget = remaining - separator.length;
    if (excerptBudget < 80) break;
    const excerpt = truncatePreviewLine(sourceExcerpt, excerptBudget);
    if (excerpt.length < 45) continue;
    const pair = `${excerpt}${separator}`;
    pairs.push(pair);
    totalCharacters += pair.length + 2;
  }
  return pairs.join("\n\n");
}

function isLikelyTestimonialAttribution(value: string) {
  const line = value.trim();
  if (line.length < 2 || line.length > 60) return false;
  const dashPrefixed = /^[-–—]\s*/.test(line);
  const name = line.replace(/^[-–—]\s*/, "");
  return /^[A-Z]{2,4}$/.test(name)
    || /^[A-Z][A-Za-z'’-]+(?:\s+(?:[A-Z][A-Za-z'’-]+|[A-Z]\.)){1,3}$/.test(name)
    || (dashPrefixed && /^[A-Z][A-Za-z'’-]+$/.test(name));
}

function truncatePreviewLine(value: string, maxCharacters: number) {
  if (value.length <= maxCharacters) return value;
  const bounded = value.slice(0, maxCharacters + 1);
  const lastWhitespace = bounded.lastIndexOf(" ");
  return (lastWhitespace >= Math.floor(maxCharacters * 0.8)
    ? bounded.slice(0, lastWhitespace)
    : bounded.slice(0, maxCharacters)).trimEnd();
}

function isLowSignalAuthorDigestLine(line: string, input: { includeTestimonials?: boolean } = {}) {
  if (/\b(?:beguiled|demoralized|charms? of pleasure|blinded by desire|nothing prevents our being able|lorem ipsum|cookie consent|this website uses cookies|we use cookies|cookies? to improve|google analytics|google ads|_setCustomVar)\b/i.test(line)) {
    return true;
  }
  return !input.includeTestimonials && (
    /^\s*["“]/.test(line)
    || /\b(?:my husband|my wife|my home|i have been|i've been|i couldn't|highly recommend|fully satisfied|our needs|gives us peace of mind|since they started|when he arrived|when she arrived|he took care|she took care|with surge pest control is always)\b/i.test(line)
  );
}

function previewSegments(rawLine: string) {
  const line = rawLine.replace(/\s+/g, " ").trim();
  const sentences = line.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  return sentences.length > 1 ? sentences : [line];
}

function authorDigestLineScore(line: string) {
  let score = Math.min(3, line.length / 120);
  if (/\b(?:we|our|us|surge|company|team|technicians?)\b/i.test(line)) score += 5;
  if (/\b(?:mission|purpose|approach|relationship[- ]based|locally owned|family owned|founded|started|committed|the way we'd want)\b/i.test(line)) score += 7;
  if (/\b(?:homeowners?|customers?|property|project|service|inspection|estimate|treatment|team|crew|work|pest control|tree care)\b/i.test(line)) score += 2;
  if (/\b(?:ants?|roaches?|rodents?|mosquitoes?|termites?|bed bugs?|bees?|wasps?|spiders?|scorpions?)\b/i.test(line)) score += 1;
  return score;
}

function containsGatedBusinessClaim(line: string) {
  const describesBusiness = /\b(?:we|our|us|surge|company|team|technicians?|services?|methods?|treatments?|plans?|programs?)\b/i.test(line);
  const gatedQuality = /\b(?:licensed|insured|certified|award(?:ed|s)?|ratings?|reviews?|guarantee(?:d|s)?|warrant(?:y|ies)|safe(?:ty|r|st)?|eco[- ]?friendly|environmentally friendly|non[- ]?toxic|pet[- ]?safe|child[- ]?safe|organic|free (?:estimates?|inspections?|consultations?|quotes?)|same[- ]?day|24\s*\/\s*7|emergency|permanent(?:ly)?|years? of experience)\b/i.test(line);
  const directSafetyClaim = /\b(?:eco[- ]?friendly|environmentally friendly|non[- ]?toxic|pet[- ]?safe|child[- ]?safe|safe for (?:people|pets|children|famil(?:y|ies)|the environment)|gentle on (?:your )?home|kind to the earth)\b/i.test(line);
  const gatedCadence = /\b(?:every (?:\d+|one|two|three|other) months?|every month|other month|quarterly|bi[- ]?monthly|recurring visits?|more frequent service|respond within)\b/i.test(line);
  const directReturnPromise = /\b(?:at no (?:additional|extra) cost|free of charge|free re[- ]?treat|free re[- ]?service|come back (?:and )?re[- ]?treat)\b/i.test(line);
  const directOffer = /\b(?:\d+% off|save \d+%|discount|limited[- ]time offer)\b/i.test(line);
  return (describesBusiness && gatedQuality) || directSafetyClaim || gatedCadence || directReturnPromise || directOffer;
}

export function mergeArchitectureEvidenceFiles(
  currentFiles: WorkspaceSourceFile[] | undefined,
  evidenceFiles: WorkspaceSourceFile[]
) {
  const merged = new Map((currentFiles ?? []).map((file) => [file.path, file]));
  for (const file of evidenceFiles) merged.set(file.path, file);
  return [...merged.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function initialArchitectureAuthoringInstruction(mode: SiteArchitectureMode = "canonical") {
  if (mode === "commercial-core-message-target") {
    return `This initial build has completed a model-authored, mechanically validated information architecture. The release service already owns and applies its exhaustive redirect and retirement ledger. Use src/approved-source-index.ts as the complete author-facing route manifest: approvedSourceIndex.liveRoutePaths is the only live internal-route set, approvedSourceIndex.primaryNavigation is the approved primary navigation, approvedSourceIndex.sourceSensitiveDocuments gives the exact readable file paths for every retained legal or policy document, approvedSourceIndex.routeSourceFiles is the compact exact route-to-evidence-file map for batched reading, and approvedSourceIndex.routes describes the live routes. Any nested sourcePath in sources or evidencePreviews is historical evidence, never a route or link target; use its approvedLinkPath whenever customer-facing source evidence needs an internal destination. Treat each route's purpose as its compact message and conversion target, not as customer-facing copy. Do not load src/approved-architecture.ts merely to repeat migration data; inspect it only if the source index or release feedback exposes a concrete route ambiguity.

The retained mirror remains searchable through source-site/ and the source tools. It is research, not render-time data: pull only the evidence needed to author final customer-ready shared route data, and never map raw extracted paragraphs into pages, cards, or metadata. Each evidencePreview is a routing sample, not a content budget or a substitute for mapped raw source. If an approved editorial, service, project, proof, or other source-rich route remains distinct, its customer value must not be reduced to the preview; use its mapped contentFiles whenever the preview does not carry the complete page argument. A retained article or guide with several supported headings and hundreds of source words needs an edited but substantive explanatory arc; a title, introduction, and three brief snippets is only a teaser, not a finished route. Shared editorial shells are appropriate, but each body must preserve the route-specific distinctions that justified retaining it. Owner facts outrank retained observations. You may use exact first-party qualitative positioning that the retained source clearly and consistently attributes to the business; specific safety, toxicity, chemical-use, certification, guarantee, price, availability, or outcome claims still require exact publicFacts support.

Build a coherent commercial site rather than a legacy archive skin. Give the home, service hub, service details, service-area hub or locations, about, contact, FAQ, and editorial routes compositions suited to their distinct customer jobs. For a source-rich multi-route site, establish readable focused route, content, and shared-shell modules on the first implementation; do not accumulate the whole route system or long legal and editorial bodies inside one giant site.tsx component. Every live route must be reachable from the concise navigation or an explicit hub. Call finish without copying the migration ledger into finish arguments.`;
  }
  if (mode === "commercial-core-pull") {
    return `This initial build has completed a model-authored, mechanically validated information architecture. Implement every explicit route in src/approved-architecture.ts and preserve its exhaustive redirect and retirement ledger.

The retained mirror remains searchable through source-site/ and the source tools. It is research, not render-time data: pull only the evidence needed to author final customer-ready shared route data, and never map raw extracted paragraphs into pages, cards, or metadata. Owner facts outrank retained observations; sensitive claims require exact publicFacts support.

Build a coherent commercial site rather than a legacy archive skin. Give the home, service hub, service details, service-area hub or locations, about, contact, FAQ, and editorial routes compositions suited to their distinct customer jobs. Every live route must be reachable from the concise navigation or an explicit hub. Call finish without copying the migration ledger into finish arguments.`;
  }
  return `This initial build has already completed its Luna High information-architecture stage. Read src/approved-architecture.ts and every retained-source-content module before implementing.

The architecture is the model-authored, mechanically validated per-site judgment for this retained source—not a fixed page target or generic service schema. Implement every explicit route in approvedArchitecture.routes. Use each route's sourcePaths mapping to select its retained first-party content. Do not replace the route set with a representative subset, wildcard, implied collection, or smaller brochure site.

Reuse retained content permissively. Preserve distinctive explanations, examples, treatments, prevention guidance, local details, and accumulated topic coverage. Redesign and edit for clarity and conversion, but do not replace source-rich pages with generic summaries. Page-specific source material should materially dominate generic template language.

Keep the approved primary navigation concise even though the crawlable route surface may be large. Use shared components and data-driven route content so the implementation stays coherent and within the workspace limit. Give service, location, guide, editorial, company, and utility routes appropriate compositions rather than forcing every page into one layout.

The approved route and migration ledger is bound to this run. Lodesta will mechanically reject missing or extra live routes before browser verification and will apply the approved redirects and retirements at finalization. Call finish without copying that migration ledger into the finish arguments.`;
}

function selectArchitectureBrowserRoutes(routes: SiteArchitectureRoute[], coverage?: "all-routes") {
  if (coverage === "all-routes") return routes.map((route) => route.path);
  const selected = new Set<string>();
  const add = (route: SiteArchitectureRoute | undefined) => { if (route) selected.add(route.path); };
  add(routes.find((route) => route.path === "/"));
  add(routes.find((route) => route.path === "/contact"));
  const representedPageTypes = new Set<string>();
  for (const route of routes) {
    if (representedPageTypes.has(route.pageType)) continue;
    representedPageTypes.add(route.pageType);
    add(route);
  }
  add([...routes].sort((left, right) => routeDepth(right.path) - routeDepth(left.path)
    || right.path.length - left.path.length
    || left.path.localeCompare(right.path))[0]);
  add([...routes].sort((left, right) => right.label.length - left.label.length
    || left.path.localeCompare(right.path))[0]);
  add([...routes].sort((left, right) => right.sourcePaths.length - left.sourcePaths.length
    || left.path.localeCompare(right.path))[0]);
  return [...selected].slice(0, 7);
}

function createRetainedContent(pages: SourceSnapshotPage[], plan: SiteArchitecturePlan) {
  const neededPaths = new Set(plan.routes.flatMap((route) => route.sourcePaths));
  const bestByPath = new Map<string, SourceSnapshotPage>();
  for (const page of pages) {
    const path = canonicalPathname(page.path);
    if (!neededPaths.has(path) || page.outcome !== "fetched" || !page.extractedText) continue;
    const current = bestByPath.get(path);
    if (!current || page.wordCount > current.wordCount) bestByPath.set(path, page);
  }
  const lineFrequency = new Map<string, number>();
  for (const page of bestByPath.values()) {
    const uniqueLines = new Set(lines(page.extractedText).map(normalizeLine).filter(Boolean));
    for (const line of uniqueLines) lineFrequency.set(line, (lineFrequency.get(line) ?? 0) + 1);
  }
  return Object.fromEntries([...bestByPath.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([path, page]) => {
    const contentLines = lines(page.extractedText).filter((line) => {
      const normalized = normalizeLine(line);
      if (!normalized) return false;
      const frequency = lineFrequency.get(normalized) ?? 0;
      if (frequency >= 8) return false;
      if (frequency >= 3 && normalized.length <= 40) return false;
      return !/^(follow|read more|navigate|home|customer login|call now|contact us)$/i.test(normalized);
    });
    return [path, {
      title: page.title ?? "",
      headings: page.headings,
      text: contentLines.join("\n").trim()
    }];
  })) as Record<string, { title: string; headings: string[]; text: string }>;
}

function createRetainedContentFiles(content: Record<string, { title: string; headings: string[]; text: string }>) {
  const chunks: Array<typeof content> = [];
  let current: typeof content = {};
  for (const [path, value] of Object.entries(content)) {
    const candidate = { ...current, [path]: value };
    if (Object.keys(current).length && JSON.stringify(candidate).length > 750_000) {
      chunks.push(current);
      current = { [path]: value };
    } else {
      current = candidate;
    }
  }
  if (Object.keys(current).length) chunks.push(current);
  const modules = chunks.map((chunk, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    return {
      path: `src/retained-source-content-${suffix}.ts`,
      content: `export const retainedSourceContent${suffix} = ${JSON.stringify(chunk)} as const;\n`
    };
  });
  const imports = modules.map((_module, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    return `import { retainedSourceContent${suffix} } from "./retained-source-content-${suffix}";`;
  });
  const spreads = modules.map((_module, index) => `  ...retainedSourceContent${String(index + 1).padStart(3, "0")}`);
  return [
    ...modules,
    {
      path: "src/retained-source-content.ts",
      content: `${imports.join("\n")}\n\nexport const retainedSourceContent = {\n${spreads.join(",\n")}\n} as const;\n`
    }
  ];
}

function canonicalPathname(value: string) {
  const pathname = value.split(/[?#]/, 1)[0] || "/";
  const normalized = `/${pathname.trim().replace(/^\/+|\/+$/g, "")}`;
  return normalized === "/" ? normalized : normalized.replace(/\/$/, "");
}

function titleFromPath(path: string) {
  if (path === "/") return "Home";
  return path.split("/").filter(Boolean).at(-1)!
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function routeDepth(path: string) {
  return path.split("/").filter(Boolean).length;
}

function lines(value: string) {
  return value.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function normalizeLine(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
