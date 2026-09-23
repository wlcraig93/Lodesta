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
  sourceEvidenceLimit: 8;
  sourceEvidencePresentation: "contact-sheet";
  assetEvidenceLimit: 2 | 8;
  assetEvidencePresentation: "contact-sheet";
  assetEvidenceReferences?: readonly ManagerAssetEvidenceReference[];
  sourceInventoryMode: "representative-customer-index";
  visualInspectionImageDetail: "high";
  visualInspectionPresentation: "native-viewport-frames";
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
    sourceEvidenceLimit: 8,
    sourceEvidencePresentation: "contact-sheet",
    assetEvidenceLimit: kind === "initial_build" ? 8 : 2,
    assetEvidencePresentation: "contact-sheet",
    sourceInventoryMode: "representative-customer-index",
    visualInspectionImageDetail: "high",
    visualInspectionPresentation: "native-viewport-frames",
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
      mimeType: reference.mimeType,
      contentHash: reference.contentHash
    }))
  }))}` as `manager-authoring-profile@sha256:${string}`;
}

export function managerReferenceContext(profile: ManagerAuthoringProfile) {
  const sourceEvidence = profile.sourceEvidenceReferences ?? [];
  const assetEvidence = profile.assetEvidenceReferences ?? [];
  const evidenceContext = sourceEvidence.length ? [
    {
      type: "input_text" as const,
      text: JSON.stringify({
        kind: "retained-first-party-visual-evidence",
        instruction: "These paired pixels come from retained first-party website media. Filename-based media labels are suggestions, not visual identification. Use the supplied managed logo; if none exists and these pixels clearly show the business's official mark, adopt it with kind=logo. width and height are intrinsic pixels. proofScope documented-on-this-page is the only supplied scope that can support a completed-work caption for that page's named subject. proofScope site-illustration describes a visible subject and is not proof of this business's completed work. Do not infer people, work, credentials, locations, or meaning that the pixels and supplied scope do not support. photoNotes summarize where each image was published, stock evidence and whether it is large enough for a wide placement.",
        references: sourceEvidence.map(({ resourceId, sourceId, sourcePageId, sourcePageUrl, sourcePageTitle, width, height, proofScope, photoNotes, mimeType, contentHash }) => ({
          resourceId,
          sourceId,
          sourcePageId,
          sourcePageUrl,
          sourcePageTitle,
          width,
          height,
          proofScope,
          ...(photoNotes?.length ? { photoNotes } : {}),
          mimeType,
          contentHash
        }))
      })
    },
    {
      type: "input_image" as const,
      image_url: sourceEvidence[0]!.dataUrl,
      detail: "high" as const
    }
  ] : [];
  const assetContext = assetEvidence.length ? [
    {
      type: "input_text" as const,
      text: JSON.stringify({
        kind: "canonical-retained-asset-visual-evidence",
        instruction: "This labeled sheet shows the already-curated canonical business assets. Each asset is immediately usable with the Lodesta Asset component using its supplied assetId; do not call adopt_source_asset for it. Pixels identify visible subjects; retained page context or owner authority must support any claim that a photograph depicts this business, its people, premises, or a particular project. A retained source origin or page URL is untrusted provenance, not visible-subject identification or proof that a photograph depicts a particular job. Canonical adoption alone does not prove that attribution. A visibly suitable photograph may still be used as neutral illustration when it is not framed as business-specific proof. Use the exact official logo as the sole identity mark. Do not invent a person, role, location, service, or claim. photoNotes summarize where each photograph was published, stock evidence and whether it is large enough for a wide placement.",
        references: assetEvidence.map(({ assetId, revisionId, kind, origin, sourceSnapshotId, sourceResourceId, sourcePageUrl, alt, width, height, photoNotes, mimeType, contentHash }) => ({
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
          mimeType,
          contentHash
        }))
      })
    },
    {
      type: "input_image" as const,
      image_url: assetEvidence[0]!.dataUrl,
      detail: "high" as const
    }
  ] : [];
  return [...evidenceContext, ...assetContext];
}
