import type { SiteVersion } from "./models";

/**
 * Diff-based publish-risk tiers (Phase 2). The triggering action sets a prior,
 * but the regenerated DIFF decides the tier: any change to page count,
 * navigation, schema-relevant facts, or homepage section structure escalates
 * to preview-then-approve regardless of how small the edit was. Gate failures
 * always escalate to operator review upstream of this check.
 */

export type PublishRiskTier = "safe" | "preview_approved" | "operator_approved";

export type PublishDiffSummary = {
  pageCountChanged: boolean;
  pageSlugsChanged: boolean;
  homepageSectionStructureChanged: boolean;
  seoChanged: boolean;
  changedSectionIds: string[];
};

type ComposedVersion = SiteVersion & {
  pageComposition?: { pages: Array<{ id: string; slug?: string; sections: Array<{ id: string; variant: string }> }> };
  pages?: Array<{ slug?: string; seo?: { title?: string; description?: string } }>;
};

export function summarizePublishDiff(previous: SiteVersion, next: SiteVersion): PublishDiffSummary {
  const prev = previous as ComposedVersion;
  const nxt = next as ComposedVersion;
  const prevPages = prev.pageComposition?.pages ?? [];
  const nextPages = nxt.pageComposition?.pages ?? [];
  const prevSlugs = prevPages.map((page) => page.slug || "home").sort();
  const nextSlugs = nextPages.map((page) => page.slug || "home").sort();
  const prevHome = prevPages.find((page) => !page.slug) ?? prevPages[0];
  const nextHome = nextPages.find((page) => !page.slug) ?? nextPages[0];
  const structure = (page?: { sections: Array<{ id: string; variant: string }> }) =>
    (page?.sections ?? []).map((section) => `${section.id}:${section.variant}`).join("|");
  const changedSectionIds: string[] = [];
  if (prevHome && nextHome) {
    const prevById = new Map(prevHome.sections.map((section) => [section.id, section.variant]));
    for (const section of nextHome.sections) {
      if (prevById.get(section.id) !== section.variant) changedSectionIds.push(section.id);
    }
  }
  return {
    pageCountChanged: prevPages.length !== nextPages.length,
    pageSlugsChanged: JSON.stringify(prevSlugs) !== JSON.stringify(nextSlugs),
    homepageSectionStructureChanged: structure(prevHome) !== structure(nextHome),
    seoChanged: JSON.stringify((prev.pages ?? []).map((page) => page.seo)) !== JSON.stringify((nxt.pages ?? []).map((page) => page.seo)),
    changedSectionIds
  };
}

/** Action classes that lean safe when the diff stays contained. */
const safeLeaningActions = new Set(["update_hours", "update_phone", "update_booking_url", "service_off", "photo_removal"]);

export function publishRiskTierForDiff(action: string, diff: PublishDiffSummary): PublishRiskTier {
  // Structural blast radius escalates regardless of the triggering action.
  if (diff.pageCountChanged || diff.pageSlugsChanged || diff.homepageSectionStructureChanged || diff.seoChanged) {
    return "preview_approved";
  }
  if (safeLeaningActions.has(action)) return "safe";
  // Unknown or content-shaping actions with contained diffs still get a preview.
  return diff.changedSectionIds.length <= 1 ? "safe" : "preview_approved";
}
