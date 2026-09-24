import { sha256, stableJson } from "@/packages/business-data";
import {
  canonicalTaskSkillFor,
  type ManagerTaskKind,
  type ManagerTaskSkill
} from "./skills";

export type ManagerSourceEvidenceReference = {
  resourceId: string;
  sourceId: string;
  sourcePageId: string;
  sourcePageUrl: string;
  sourcePageTitle?: string;
  /** Role of the page the photo was published on. */
  pageRole?: "home" | "service" | "about" | "portfolio" | "other";
  /** 1-based contact sheet carrying this photo. */
  sheet?: number;
  /** 1-based photo number printed on the contact sheet. */
  cell?: number;
  width?: number | null;
  height?: number | null;
  proofScope?: "documented-on-this-page" | "site-illustration";
  photoNotes?: readonly string[];
  mimeType: "image/webp" | "image/png";
  contentHash: `sha256:${string}`;
  dataUrl: string;
};

export type ManagerAssetEvidenceReference = {
  assetId: string;
  revisionId: string;
  kind: "photo" | "logo" | "icon" | "document" | "other";
  origin: "source_website" | "owner_upload" | "platform_generated";
  sourceSnapshotId?: string;
  sourceResourceId?: string;
  sourcePageUrl?: string;
  alt: string;
  width?: number;
  height?: number;
  photoNotes?: readonly string[];
  /** Pixel labels from pre-authoring photo curation (author context only). */
  curation?: {
    subject: string;
    quality: string;
    heroCapable: boolean;
  };
  /** 1-based contact sheet carrying this asset. */
  sheet?: number;
  /** 1-based asset number printed on the contact sheet. */
  cell?: number;
  mimeType: "image/png" | "image/webp";
  contentHash: `sha256:${string}`;
  dataUrl: string;
};

export const canonicalAuthoringProfileId = "canonical" as const;
export type CanonicalAuthoringProfileId = typeof canonicalAuthoringProfileId;

/** The sole executable site-authoring configuration. */
export type ManagerAuthoringProfile = {
  profileId: CanonicalAuthoringProfileId;
  taskSkill: ManagerTaskSkill;
  systemPrompt: "compact-full-site-pull-source";
  architectureMode: "commercial-core-message-target";
  architectureEvidenceMode: "indexed-pull-preview-readable";
  architectureBrowserCoverage: "all-routes";
  sourceEvidenceReferences?: readonly ManagerSourceEvidenceReference[];
  sourceEvidenceLimit: 60;
  sourceEvidenceSheetSize: 12;
  sourceEvidencePresentation: "numbered-contact-sheets";
  assetEvidenceLimit: 2 | 40;
  assetEvidencePresentation: "contact-sheet";
  assetEvidenceReferences?: readonly ManagerAssetEvidenceReference[];
  sourceInventoryMode: "representative-customer-index";
  visualInspectionImageDetail: "high";
  visualInspectionPresentation: "full-page-and-first-viewport-sheet";
  visualInspectionFeedback: "component-diagnostic-route-family-quality-led";
};

export function retainedContentModeForAuthoringProfile(
  profile: Pick<ManagerAuthoringProfile, "architectureEvidenceMode"> | undefined
): "indexed-pull-preview-readable" {
  return profile?.architectureEvidenceMode ?? "indexed-pull-preview-readable";
}

export function canonicalAuthoringProfile(kind: ManagerTaskKind): ManagerAuthoringProfile {
  return {
    profileId: canonicalAuthoringProfileId,
    taskSkill: canonicalTaskSkillFor(kind),
    systemPrompt: "compact-full-site-pull-source",
    architectureMode: "commercial-core-message-target",
    architectureEvidenceMode: "indexed-pull-preview-readable",
    architectureBrowserCoverage: "all-routes",
    sourceEvidenceLimit: 60,
    sourceEvidenceSheetSize: 12,
    sourceEvidencePresentation: "numbered-contact-sheets",
    assetEvidenceLimit: kind === "initial_build" ? 40 : 2,
    assetEvidencePresentation: "contact-sheet",
    sourceInventoryMode: "representative-customer-index",
    visualInspectionImageDetail: "high",
    visualInspectionPresentation: "full-page-and-first-viewport-sheet",
    visualInspectionFeedback: "component-diagnostic-route-family-quality-led"
  };
}

export function liveAuthoringProfile(
  profileId: string | undefined,
  kind: ManagerTaskKind
): ManagerAuthoringProfile {
  if (profileId && profileId !== canonicalAuthoringProfileId) {
    throw new Error(`retired_authoring_profile:${profileId}`);
  }
  return canonicalAuthoringProfile(kind);
}

export function managerAuthoringProfileIdentity(profile: ManagerAuthoringProfile) {
  return `manager-authoring-profile@${sha256(stableJson({
    profileId: profile.profileId,
    taskSkillIdentity: profile.taskSkill.identity,
    systemPrompt: profile.systemPrompt,
    sourceEvidenceLimit: profile.sourceEvidenceLimit,
    sourceEvidenceSheetSize: profile.sourceEvidenceSheetSize,
    sourceEvidencePresentation: profile.sourceEvidencePresentation,
    assetEvidenceLimit: profile.assetEvidenceLimit,
    assetEvidencePresentation: profile.assetEvidencePresentation,
    sourceInventoryMode: profile.sourceInventoryMode,
    visualInspectionImageDetail: profile.visualInspectionImageDetail,
    visualInspectionPresentation: profile.visualInspectionPresentation,
    architectureMode: profile.architectureMode,
    architectureEvidenceMode: profile.architectureEvidenceMode,
    architectureBrowserCoverage: profile.architectureBrowserCoverage,
    visualInspectionFeedback: profile.visualInspectionFeedback,
    sourceEvidenceReferences: (profile.sourceEvidenceReferences ?? []).map((reference) => ({
      resourceId: reference.resourceId,
      sourceId: reference.sourceId,
      sourcePageId: reference.sourcePageId,
      sourcePageUrl: reference.sourcePageUrl,
      sourcePageTitle: reference.sourcePageTitle,
      pageRole: reference.pageRole,
      sheet: reference.sheet,
      cell: reference.cell,
      width: reference.width,
      height: reference.height,
      proofScope: reference.proofScope,
      photoNotes: reference.photoNotes,
      mimeType: reference.mimeType,
      contentHash: reference.contentHash
    })),
    assetEvidenceReferences: (profile.assetEvidenceReferences ?? []).map((reference) => ({
      assetId: reference.assetId,
      revisionId: reference.revisionId,
      kind: reference.kind,
      origin: reference.origin,
      sourceSnapshotId: reference.sourceSnapshotId,
      sourceResourceId: reference.sourceResourceId,
      sourcePageUrl: reference.sourcePageUrl,
      alt: reference.alt,
      width: reference.width,
      height: reference.height,
      photoNotes: reference.photoNotes,
      curation: reference.curation,
      sheet: reference.sheet,
      cell: reference.cell,
      mimeType: reference.mimeType,
      contentHash: reference.contentHash
    }))
  }))}` as `manager-authoring-profile@sha256:${string}`;
}

export function managerReferenceContext(profile: ManagerAuthoringProfile) {
  const sourceEvidence = profile.sourceEvidenceReferences ?? [];
  const assetEvidence = profile.assetEvidenceReferences ?? [];
  // One image per distinct contact sheet, in sheet order.
  const sheets = [...new Map(sourceEvidence.map((reference) => [reference.contentHash, reference])).values()];
  const curatedGallery = assetEvidence.some((reference) => reference.curation);
  const evidenceContext = sourceEvidence.length ? [
    {
      type: "input_text" as const,
      text: JSON.stringify({
        kind: "retained-first-party-visual-evidence",
        instruction: (curatedGallery
          ? "These are the retained website photos that are not in the curated gallery (usually weaker, duplicate-like or less relevant), shown on the numbered contact sheets that follow (cell is the # printed on the sheet). Prefer the curated gallery. "
          : "This is the photo inventory of the business's retained website: every distinct usable photo up to the sheet ceiling, shown on the numbered contact sheets that follow (cell is the # printed on the sheet). ")
          + "Any listed photo can be adopted now with adopt_source_asset using its sourceId, resourceId and sourcePageId; list_source_resources with role=image lists lower-ranked retained images beyond these sheets. pageRole and sourcePageUrl say where each photo was published. Filename-based media labels are suggestions, not visual identification. Use the supplied managed logo; if none exists and these pixels clearly show the business's official mark, adopt it with kind=logo. width and height are intrinsic pixels. proofScope documented-on-this-page is the only supplied scope that can support a completed-work caption for that page's named subject. proofScope site-illustration describes a visible subject and is not proof of this business's completed work. Do not infer people, work, credentials, locations, or meaning that the pixels and supplied scope do not support. photoNotes summarize where each image was published, stock evidence and whether it is large enough for a wide placement.",
        sheets: sheets.map((reference, index) => ({
          sheet: reference.sheet ?? index + 1,
          mimeType: reference.mimeType,
          contentHash: reference.contentHash
        })),
        references: sourceEvidence.map(({ resourceId, sourceId, sourcePageId, sourcePageUrl, sourcePageTitle, pageRole, sheet, cell, width, height, proofScope, photoNotes }) => ({
          ...(cell ? { cell } : {}),
          ...(sheet ? { sheet } : {}),
          resourceId,
          sourceId,
          sourcePageId,
          ...(pageRole ? { pageRole } : {}),
          sourcePageUrl,
          sourcePageTitle,
          width,
          height,
          proofScope,
          ...(photoNotes?.length ? { photoNotes } : {})
        }))
      })
    },
    ...sheets.map((reference) => ({
      type: "input_image" as const,
      image_url: reference.dataUrl,
      detail: "high" as const
    }))
  ] : [];
  // One image per distinct asset contact sheet, in sheet order.
  const assetSheets = [...new Map(assetEvidence.map((reference) => [reference.contentHash, reference])).values()];
  const assetContext = assetEvidence.length ? [
    {
      type: "input_text" as const,
      text: JSON.stringify({
        kind: "canonical-retained-asset-visual-evidence",
        instruction: (curatedGallery
          ? "This is the curated gallery: the business's best retained first-party photographs, already adopted as canonical assets, plus any other canonical assets, on the labeled contact sheets that follow (cell is the # printed on the sheet). curation gives each photo's subject, quality and whether it is strong enough for a wide hero; alt is a factual description of the pixels and is the asset's default alt text. Use these photos generously and directly; the hero should use a heroCapable photo when one fits. "
          : "These labeled sheets show the already-curated canonical business assets. ")
          + "Each asset is immediately usable with the Lodesta Asset component using its supplied assetId; do not call adopt_source_asset for it. Pixels identify visible subjects; retained page context or owner authority must support any claim that a photograph depicts this business, its people, premises, or a particular project. A retained source origin or page URL is untrusted provenance, not visible-subject identification or proof that a photograph depicts a particular job. Canonical adoption alone does not prove that attribution. A visibly suitable photograph may still be used as neutral illustration when it is not framed as business-specific proof. Use the exact official logo as the sole identity mark. Do not invent a person, role, location, service, or claim. photoNotes summarize where each photograph was published, stock evidence and whether it is large enough for a wide placement.",
        sheets: assetSheets.map((reference, index) => ({
          sheet: reference.sheet ?? index + 1,
          mimeType: reference.mimeType,
          contentHash: reference.contentHash
        })),
        references: assetEvidence.map(({ assetId, revisionId, kind, origin, sourceSnapshotId, sourceResourceId, sourcePageUrl, alt, width, height, photoNotes, curation, sheet, cell, mimeType, contentHash }) => ({
          ...(cell ? { cell } : {}),
          ...(sheet ? { sheet } : {}),
          assetId,
          revisionId,
          kind,
          origin,
          sourceSnapshotId,
          sourceResourceId,
          sourcePageUrl,
          alt,
          ...(width && height ? { width, height } : {}),
          ...(photoNotes?.length ? { photoNotes } : {}),
          ...(curation ? { curation } : {}),
          mimeType,
          contentHash
        }))
      })
    },
    ...assetSheets.map((reference) => ({
      type: "input_image" as const,
      image_url: reference.dataUrl,
      detail: "high" as const
    }))
  ] : [];
  return [...evidenceContext, ...assetContext];
}
