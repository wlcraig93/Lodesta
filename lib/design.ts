import { runAudit } from "./audit";
import type { DesignPlan, LayoutSectionPreset, SiteBundle, SiteVersion } from "./models";
import { applyPresetToLayoutSection, syncVersionLegacySections, validateDesignPlan } from "./layout-registry";
import { themeForPreset } from "./theme-presets";

export type UpdateSiteDesignInput = {
  siteId: string;
  pageId?: string;
  designPlan?: Partial<DesignPlan>;
  layoutSectionOrder?: string[];
  sectionPresets?: Record<string, LayoutSectionPreset>;
};

export type UpdateSiteDesignResult =
  | {
      ok: true;
      bundle: SiteBundle;
      draftVersionId: string;
      applied: {
        designPlan?: Partial<DesignPlan>;
        layoutSectionOrder?: string[];
        sectionPresets?: Record<string, LayoutSectionPreset>;
      };
    }
  | {
      ok: false;
      reason: string;
    };

export function updateSiteDesignBundle(bundle: SiteBundle, input: UpdateSiteDesignInput): UpdateSiteDesignResult {
  const draft = clonePublishedAsDraft(bundle);
  const applied: {
    designPlan?: Partial<DesignPlan>;
    layoutSectionOrder?: string[];
    sectionPresets?: Record<string, LayoutSectionPreset>;
  } = {};

  if (input.designPlan) {
    const nextDesignPlan = {
      ...draft.designPlan,
      ...input.designPlan
    };
    const designIssues = validateDesignPlan(nextDesignPlan);
    if (designIssues.length) return { ok: false, reason: designIssues.join(" ") };
    draft.designPlan = nextDesignPlan;
    applied.designPlan = input.designPlan;
  }

  if (input.designPlan?.colorSystem) {
    draft.theme = themeForPreset(
      bundle.businessProfile.vertical,
      input.designPlan.colorSystem,
      draft.theme ?? bundle.siteModel.theme
    );
  }

  const page = draft.pages.find((candidate) => candidate.id === (input.pageId ?? "page_home")) ?? draft.pages[0];
  if ((input.layoutSectionOrder || input.sectionPresets) && !page) return { ok: false, reason: "No editable page found." };

  if (input.layoutSectionOrder && page) {
    const existingIds = page.layoutSections.map((section) => section.id);
    const requestedIds = input.layoutSectionOrder;
    const existingSet = new Set(existingIds);
    const requestedSet = new Set(requestedIds);
    if (existingIds.length !== requestedIds.length || existingIds.some((id) => !requestedSet.has(id)) || requestedIds.some((id) => !existingSet.has(id))) {
      return { ok: false, reason: "Layout section order must include every current layout section exactly once." };
    }
    const sectionsById = new Map(page.layoutSections.map((section) => [section.id, section]));
    page.layoutSections = requestedIds.map((id) => sectionsById.get(id)).filter((section): section is NonNullable<typeof section> => Boolean(section));
    applied.layoutSectionOrder = requestedIds;
  }

  if (input.sectionPresets && page) {
    const appliedPresets: Record<string, LayoutSectionPreset> = {};
    for (const [sectionId, preset] of Object.entries(input.sectionPresets)) {
      const section = page.layoutSections.find((candidate) => candidate.id === sectionId);
      if (!section) return { ok: false, reason: `Layout section ${sectionId} was not found on the editable page.` };
      if (!applyPresetToLayoutSection(section, preset)) {
        return { ok: false, reason: `Preset ${preset} is not approved for ${section.kind} sections.` };
      }
      appliedPresets[sectionId] = preset;
    }
    applied.sectionPresets = appliedPresets;
  }

  syncVersionLegacySections(draft);
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
