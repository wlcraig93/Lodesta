import { runAudit } from "./audit";
import type { SiteBundle, SiteVersion } from "./models";
import { approvedVariantsForSection } from "./section-variants";
import { themeForPreset, type ThemePresetId } from "./theme-presets";

export type UpdateSiteDesignInput = {
  siteId: string;
  pageId?: string;
  themePreset?: ThemePresetId;
  sectionOrder?: string[];
  sectionVariants?: Record<string, string>;
};

export type UpdateSiteDesignResult =
  | {
      ok: true;
      bundle: SiteBundle;
      draftVersionId: string;
      applied: {
        themePreset?: ThemePresetId;
        sectionOrder?: string[];
        sectionVariants?: Record<string, string>;
      };
    }
  | {
      ok: false;
      reason: string;
    };

export function updateSiteDesignBundle(bundle: SiteBundle, input: UpdateSiteDesignInput): UpdateSiteDesignResult {
  const draft = clonePublishedAsDraft(bundle);
  const applied: {
    themePreset?: ThemePresetId;
    sectionOrder?: string[];
    sectionVariants?: Record<string, string>;
  } = {};

  if (input.themePreset) {
    draft.theme = themeForPreset(
      bundle.businessProfile.vertical,
      input.themePreset,
      draft.theme ?? bundle.siteModel.theme
    );
    applied.themePreset = input.themePreset;
  }

  const page = draft.pages.find((candidate) => candidate.id === (input.pageId ?? "page_home")) ?? draft.pages[0];
  if ((input.sectionOrder || input.sectionVariants) && !page) return { ok: false, reason: "No editable page found." };

  if (input.sectionOrder && page) {
    const existingIds = page.sections.map((section) => section.id);
    const requestedIds = input.sectionOrder;
    const existingSet = new Set(existingIds);
    const requestedSet = new Set(requestedIds);
    if (existingIds.length !== requestedIds.length || existingIds.some((id) => !requestedSet.has(id)) || requestedIds.some((id) => !existingSet.has(id))) {
      return { ok: false, reason: "Section order must include every current section exactly once." };
    }
    const sectionsById = new Map(page.sections.map((section) => [section.id, section]));
    page.sections = requestedIds.map((id) => sectionsById.get(id)).filter((section): section is NonNullable<typeof section> => Boolean(section));
    applied.sectionOrder = requestedIds;
  }

  if (input.sectionVariants && page) {
    const appliedVariants: Record<string, string> = {};
    for (const [sectionId, variant] of Object.entries(input.sectionVariants)) {
      const section = page.sections.find((candidate) => candidate.id === sectionId);
      if (!section) return { ok: false, reason: `Section ${sectionId} was not found on the editable page.` };
      const approved = approvedVariantsForSection(section.type, section.variant);
      if (!approved.some((option) => option.id === variant)) {
        return { ok: false, reason: `Variant ${variant} is not approved for ${section.type} sections.` };
      }
      section.variant = variant;
      appliedVariants[sectionId] = variant;
    }
    applied.sectionVariants = appliedVariants;
  }

  bundle.optimizationFindings = runAudit(bundle.businessProfile, bundle.siteModel);
  return {
    ok: true,
    bundle,
    draftVersionId: draft.id,
    applied
  };
}

function clonePublishedAsDraft(bundle: SiteBundle): SiteVersion {
  const existingDraft = bundle.siteModel.versions.find((version) => version.status === "draft");
  if (existingDraft) {
    existingDraft.theme ??= structuredClone(bundle.siteModel.theme);
    return existingDraft;
  }
  const published = bundle.siteModel.versions.find((version) => version.status === "published") ?? bundle.siteModel.versions[0];
  const draft = structuredClone(published);
  draft.id = `version_${bundle.siteModel.slug}_draft_${Date.now()}`;
  draft.status = "draft";
  draft.createdAt = new Date().toISOString();
  draft.theme ??= structuredClone(bundle.siteModel.theme);
  bundle.siteModel.versions.unshift(draft);
  return draft;
}
