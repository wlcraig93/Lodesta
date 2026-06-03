import type {
  BusinessProfile,
  ClaimCategoryV2,
  CompiledSectionV2,
  CopyArtifactV2,
  GenerationArtifactV2,
  SiteBundle,
  SiteVersion,
  SiteVersionV2
} from "./models";
import { copyRefreshProducerV2, createLocalBusinessCopyArtifactV2, hashTextV2 } from "./copy-local-business-marketing";
import { proposeCopyArtifactDiffsV2, type GeneratedSiteV2Diff } from "./generated-site-v2-diffs";

export type CopyRefreshAuditV2Result = {
  skillId: typeof copyRefreshProducerV2.id;
  skillVersion: typeof copyRefreshProducerV2.version;
  versionId?: string;
  candidates: CopyArtifactV2[];
  diffs: GeneratedSiteV2Diff[];
  artifacts: GenerationArtifactV2[];
  summary: string;
};

export function runCopyRefreshAuditV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): CopyRefreshAuditV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  if (!version || version.rendererVersion !== "layout-v2") {
    return {
      skillId: copyRefreshProducerV2.id,
      skillVersion: copyRefreshProducerV2.version,
      candidates: [],
      diffs: [],
      artifacts: [],
      summary: "Copy refresh audit skipped because the selected site version is not layout-v2."
    };
  }

  const candidates = copyRefreshCandidatesForVersion({
    business: input.bundle.businessProfile,
    version
  });
  const diffs = proposeCopyArtifactDiffsV2({ version, candidateArtifacts: candidates }).filter((diff) => diff.status !== "unchanged");
  const artifacts = copyRefreshArtifactsForV2({
    siteId: input.siteId ?? input.bundle.businessProfile.siteId,
    candidates,
    diffs,
    createdAt: input.createdAt
  });
  const proposed = diffs.filter((diff) => diff.status === "proposed").length;
  const blocked = diffs.filter((diff) => diff.status === "blocked").length;

  return {
    skillId: copyRefreshProducerV2.id,
    skillVersion: copyRefreshProducerV2.version,
    versionId: version.id,
    candidates,
    diffs,
    artifacts,
    summary: `${proposed} proposed copy refresh diff${proposed === 1 ? "" : "s"}${blocked ? `; ${blocked} blocked` : ""}.`
  };
}

function copyRefreshCandidatesForVersion(input: {
  business: BusinessProfile;
  version: SiteVersionV2;
}): CopyArtifactV2[] {
  return input.version.compiledPages.flatMap((page) =>
    page.sections.flatMap((section) => {
      const suggestions = suggestionsForSection(input.business, input.version, section);
      return suggestions.map((suggestion) =>
        createLocalBusinessCopyArtifactV2({
          slotId: suggestion.slotId,
          text: suggestion.text,
          category: suggestion.category,
          factIds: suggestion.factIds,
          verticalPlaybookVersion: input.version.blueprint.verticalPlaybookVersion,
          sectionContractVersion: sectionContractVersionFor(input.version),
          producerId: copyRefreshProducerV2.id,
          producerVersion: copyRefreshProducerV2.version,
          status: "candidate"
        })
      );
    })
  );
}

function suggestionsForSection(
  business: BusinessProfile,
  version: SiteVersionV2,
  section: CompiledSectionV2
): Array<{ slotId: string; text: string; category: ClaimCategoryV2; factIds: string[] }> {
  const props = section.props as Record<string, unknown>;
  const vertical = version.blueprint.vertical;
  const service = primaryServiceFromSection(business, section);
  if (section.family.startsWith("hero.")) {
    const next = heroSubheadlineRefresh(vertical, service);
    if (next && next !== props.subheadline) {
      return [
        {
          slotId: "home.hero.subheadline",
          text: next,
          category: service ? "service" : "business_identity",
          factIds: section.sourceFactIds
        }
      ];
    }
  }
  if (section.family === "contact.location_hours") {
    const next = contactHeadingRefresh(vertical, Boolean(props.hours));
    if (next !== props.heading) {
      return [
        {
          slotId: "home.contact.heading",
          text: next,
          category: props.hours ? "hours" : "contact",
          factIds: section.sourceFactIds
        }
      ];
    }
  }
  return [];
}

function heroSubheadlineRefresh(vertical: SiteVersionV2["blueprint"]["vertical"], service: string | undefined) {
  if (vertical === "auto_body") {
    return service
      ? `Share the damage, photos, and timing so the shop can understand the right ${service.toLowerCase()} next step.`
      : "Share the damage, photos, and timing so the shop can understand the right next step.";
  }
  if (vertical === "restaurant") {
    return service
      ? `Use the ${service.toLowerCase()} details, hours, and contact path to choose the next order or catering step.`
      : "Use the restaurant details, hours, and contact path to choose the next order or visit step.";
  }
  if (vertical === "home_services") {
    return service
      ? `Describe the ${service.toLowerCase()} need, location, and timing so the team can confirm fit before the next step.`
      : "Describe the service need, location, and timing so the team can confirm fit before the next step.";
  }
  return undefined;
}

function contactHeadingRefresh(vertical: SiteVersionV2["blueprint"]["vertical"], hasHours: boolean) {
  if (vertical === "auto_body") return hasHours ? "Call, visit, or plan the estimate around shop hours" : "Call before you visit the shop";
  if (vertical === "restaurant") return hasHours ? "Order, call, or plan the visit around current hours" : "Call before you order or visit";
  if (vertical === "home_services") return hasHours ? "Call or request service around current hours" : "Call to confirm current service availability";
  return hasHours ? "Call or plan around current hours" : "Call to confirm current availability";
}

function primaryServiceFromSection(business: BusinessProfile, section: CompiledSectionV2) {
  const props = section.props as Record<string, unknown>;
  const proofItems = props.proofItems;
  if (Array.isArray(proofItems) && typeof proofItems[0] === "string") return proofItems[0];
  return business.services[0];
}

function sectionContractVersionFor(version: SiteVersionV2) {
  if (version.blueprint.vertical === "restaurant") return "restaurant-section-contracts-v1";
  if (version.blueprint.vertical === "home_services") return "home-services-section-contracts-v1";
  return "auto-body-section-contracts-v1";
}

function copyRefreshArtifactsForV2(input: {
  siteId: string;
  candidates: CopyArtifactV2[];
  diffs: GeneratedSiteV2Diff[];
  createdAt?: string;
}): GenerationArtifactV2[] {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const candidateArtifacts = input.candidates.map((candidate): GenerationArtifactV2 => ({
    id: `artifact_${input.siteId}_${candidate.id}`,
    siteId: input.siteId,
    scope: "managed_site_candidate",
    artifactType: "copy_artifact",
    artifactVersion: candidate.artifactVersion,
    producerId: candidate.producerId,
    producerVersion: candidate.producerVersion,
    verticalPlaybookVersion: candidate.verticalPlaybookVersion,
    sectionContractVersion: candidate.sectionContractVersion,
    sourceFactIds: Array.from(new Set(candidate.claimSpans.flatMap((span) => span.sourceFactIds))),
    affectedSlotId: candidate.slotId,
    contentHash: hashTextV2(candidate.text),
    payload: {
      text: candidate.text,
      claimSpans: candidate.claimSpans,
      status: candidate.status
    },
    createdAt
  }));
  const diffArtifacts = input.diffs.map((diff): GenerationArtifactV2 => ({
    id: `artifact_${input.siteId}_${diff.id}`,
    siteId: input.siteId,
    scope: "managed_site_candidate",
    artifactType: "copy_diff",
    artifactVersion: "copy-diff-v2",
    producerId: diff.producerId,
    producerVersion: diff.producerVersion,
    verticalPlaybookVersion: diff.verticalPlaybookVersion,
    sectionContractVersion: diff.sectionContractVersion,
    sourceFactIds: [],
    affectedPageId: diff.targetPageId,
    affectedSectionId: diff.targetSectionId,
    affectedSlotId: diff.targetSlotId,
    contentHash: diff.proposedContentHash,
    payload: { diff },
    createdAt
  }));
  return [...candidateArtifacts, ...diffArtifacts];
}
