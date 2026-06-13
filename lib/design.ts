import { runAudit } from "./audit";
import { markVersionOwnerTouched } from "./site-version-metadata";
import { assertSiteVersionV3 } from "./site-version-v3";
import type { DesignPlan, SiteBundle, SiteVersionV3 } from "./models";

export type UpdateSiteDesignInput = {
  siteId: string;
  pageId?: string;
  designPlan?: Partial<DesignPlan>;
  sectionOrder?: string[];
  sectionTemplates?: Record<string, string>;
};

export type UpdateSiteDesignResult =
  | {
      ok: true;
      bundle: SiteBundle;
      draftVersionId: string;
      applied: {
        designPlan?: Partial<DesignPlan>;
        sectionOrder?: string[];
        sectionTemplates?: Record<string, string>;
      };
    }
  | {
      ok: false;
      reason: string;
    };

export function updateSiteDesignBundle(bundle: SiteBundle, input: UpdateSiteDesignInput): UpdateSiteDesignResult {
  const draft = clonePublishedAsDraftV3(bundle);
  const applied: Extract<UpdateSiteDesignResult, { ok: true }>["applied"] = {};

  if (input.designPlan) {
    draft.designPlan = {
      ...fallbackDesignPlan(),
      ...draft.designPlan,
      ...input.designPlan
    };
    applied.designPlan = input.designPlan;
  }

  const page = draft.pageComposition.pages.find((candidate) => candidate.id === (input.pageId ?? "home")) ?? draft.pageComposition.pages[0];
  if ((input.sectionOrder || input.sectionTemplates) && !page) return { ok: false, reason: "No editable page found." };

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

  if (input.sectionTemplates && Object.keys(input.sectionTemplates).length) {
    return { ok: false, reason: "V3 template changes must go through compiler overrides; direct template mutation is not supported." };
  }

  markVersionOwnerTouched(draft);
  bundle.optimizationFindings = runAudit(bundle.businessProfile, bundle.siteModel);
  return {
    ok: true,
    bundle,
    draftVersionId: draft.id,
    applied
  };
}

function clonePublishedAsDraftV3(bundle: SiteBundle): SiteVersionV3 {
  const existingDraft = bundle.siteModel.versions.find((version) => version.status === "draft");
  if (existingDraft) return assertSiteVersionV3(existingDraft, "design draft");
  const published = bundle.siteModel.versions.find((version) => version.status === "published") ?? bundle.siteModel.versions[0];
  const draft = structuredClone(assertSiteVersionV3(published, "published version for design draft"));
  draft.id = `version_${bundle.siteModel.slug}_draft_${Date.now()}`;
  draft.status = "draft";
  draft.createdAt = new Date().toISOString();
  bundle.siteModel.versions.unshift(draft);
  return draft;
}

function fallbackDesignPlan(): DesignPlan {
  return {
    stylePack: "local_modern",
    typographyPack: "clean_sans",
    colorSystem: "warm",
    spacingDensity: "standard",
    buttonStyle: "solid",
    radiusStyle: "soft",
    imageTreatment: "natural",
    motionPolicy: "subtle"
  };
}
