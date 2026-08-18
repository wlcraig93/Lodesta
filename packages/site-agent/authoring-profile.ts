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
  mimeType: "image/webp" | "image/png";
  contentHash: `sha256:${string}`;
  dataUrl: string;
};

export type ManagerAssetEvidenceReference = {
  assetId: string;
  revisionId: string;
  kind: "photo" | "logo" | "icon" | "document" | "other";
  alt: string;
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
  architectureMode: "commercial-core-pull";
  architectureEvidenceMode: "indexed-pull-preview-readable";
  architectureBrowserCoverage: "all-page-types";
  disabledTools: readonly ["create_image"];
  sourceEvidenceReferences?: readonly ManagerSourceEvidenceReference[];
  sourceEvidenceLimit: 4;
  sourceEvidencePresentation: "contact-sheet";
  assetEvidenceLimit: 2;
  assetEvidencePresentation: "contact-sheet";
  assetEvidenceReferences?: readonly ManagerAssetEvidenceReference[];
  sourceInventoryMode: "representative-customer-index";
  visualInspectionImageDetail: "high";
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
    architectureMode: "commercial-core-pull",
    architectureEvidenceMode: "indexed-pull-preview-readable",
    architectureBrowserCoverage: "all-page-types",
    disabledTools: ["create_image"],
    sourceEvidenceLimit: 4,
    sourceEvidencePresentation: "contact-sheet",
    assetEvidenceLimit: 2,
    assetEvidencePresentation: "contact-sheet",
    sourceInventoryMode: "representative-customer-index",
    visualInspectionImageDetail: "high",
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
    disabledTools: [...profile.disabledTools].sort(),
    sourceEvidenceLimit: profile.sourceEvidenceLimit,
    sourceEvidencePresentation: profile.sourceEvidencePresentation,
    assetEvidenceLimit: profile.assetEvidenceLimit,
    assetEvidencePresentation: profile.assetEvidencePresentation,
    sourceInventoryMode: profile.sourceInventoryMode,
    visualInspectionImageDetail: profile.visualInspectionImageDetail,
    architectureEvidenceMode: profile.architectureEvidenceMode,
    architectureBrowserCoverage: profile.architectureBrowserCoverage,
    visualInspectionFeedback: profile.visualInspectionFeedback,
    sourceEvidenceReferences: (profile.sourceEvidenceReferences ?? []).map((reference) => ({
      resourceId: reference.resourceId,
      sourceId: reference.sourceId,
      sourcePageId: reference.sourcePageId,
      mimeType: reference.mimeType,
      contentHash: reference.contentHash
    })),
    assetEvidenceReferences: (profile.assetEvidenceReferences ?? []).map((reference) => ({
      assetId: reference.assetId,
      revisionId: reference.revisionId,
      kind: reference.kind,
      alt: reference.alt,
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
        instruction: "These paired pixels come from retained first-party website media other than the platform-managed canonical logo. Judge what is visibly present before choosing the visual direction. Adopt a photograph only when its visible subject genuinely supports the intended section. Do not infer people, work, credentials, or meaning that is not visible.",
        references: sourceEvidence.map(({ resourceId, sourceId, sourcePageId, mimeType, contentHash }) => ({
          resourceId,
          sourceId,
          sourcePageId,
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
        instruction: "This labeled sheet shows the already-curated canonical business assets. Each asset is immediately usable with the Lodesta Asset component using its supplied assetId; do not call adopt_source_asset for it. Judge visible pixels rather than inferred semantics. Use the exact official logo as the sole identity mark, and use a visibly relevant photograph only where it adds authentic proof. Do not invent a person, role, location, service, or claim.",
        references: assetEvidence.map(({ assetId, revisionId, kind, alt, mimeType, contentHash }) => ({
          assetId,
          revisionId,
          kind,
          alt,
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
