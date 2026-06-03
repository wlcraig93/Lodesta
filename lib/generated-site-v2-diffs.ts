import type { CopyArtifactV2, GenerationQaBlocker, SiteVersionV2 } from "./models";
import { hashTextV2 } from "./copy-local-business-marketing";

export type GeneratedSiteV2DiffScope = "slot" | "section" | "page";

export type GeneratedSiteV2Diff = {
  id: string;
  scope: GeneratedSiteV2DiffScope;
  targetVersionId: string;
  targetPageId?: string;
  targetSectionId?: string;
  targetSlotId: string;
  previousArtifactId?: string;
  proposedArtifactId: string;
  previousContentHash?: string;
  proposedContentHash: string;
  producerId: string;
  producerVersion: string;
  verticalPlaybookVersion: string;
  sectionContractVersion: string;
  summary: string;
  blockers: GenerationQaBlocker[];
  status: "proposed" | "blocked" | "unchanged";
};

export function proposeCopyArtifactDiffsV2(input: {
  version: SiteVersionV2;
  candidateArtifacts: CopyArtifactV2[];
}): GeneratedSiteV2Diff[] {
  const refsBySlot = new Map(input.version.artifactRefs.map((ref) => [ref.affectedSlotId, ref]));
  return input.candidateArtifacts.flatMap((artifact) => {
    const proposedContentHash = hashTextV2(artifact.text);
    const existingRef = refsBySlot.get(artifact.slotId);
    const blockers = diffBlockersForArtifact(input.version, artifact, existingRef?.affectedSectionId);
    const unchanged = existingRef?.contentHash === proposedContentHash;
    return [
      {
        id: `diff_${input.version.id}_${artifact.slotId.replace(/[^a-z0-9]+/gi, "_")}_${proposedContentHash.slice(0, 10)}`,
        scope: "slot",
        targetVersionId: input.version.id,
        targetPageId: existingRef?.affectedPageId,
        targetSectionId: existingRef?.affectedSectionId,
        targetSlotId: artifact.slotId,
        previousArtifactId: existingRef?.artifactId,
        proposedArtifactId: artifact.id,
        previousContentHash: existingRef?.contentHash,
        proposedContentHash,
        producerId: artifact.producerId,
        producerVersion: artifact.producerVersion,
        verticalPlaybookVersion: artifact.verticalPlaybookVersion,
        sectionContractVersion: artifact.sectionContractVersion,
        summary: unchanged ? `No change for ${artifact.slotId}.` : `Replace copy in ${artifact.slotId}.`,
        blockers,
        status: blockers.length ? "blocked" : unchanged ? "unchanged" : "proposed"
      }
    ];
  });
}

function diffBlockersForArtifact(
  version: SiteVersionV2,
  artifact: CopyArtifactV2,
  affectedSectionId: string | undefined
): GenerationQaBlocker[] {
  const blockers: GenerationQaBlocker[] = [];
  if (!affectedSectionId) {
    blockers.push({
      id: "v2_diff_unknown_section",
      title: "Copy diff cannot find the affected section",
      detail: `No compiled section is linked to ${artifact.slotId}; the diff cannot be applied safely.`,
      category: "quality_failed",
      severity: "blocking"
    });
    return blockers;
  }

  const section = version.compiledPages.flatMap((page) => page.sections).find((candidate) => candidate.id === affectedSectionId);
  if (!section) {
    blockers.push({
      id: "v2_diff_missing_section",
      title: "Copy diff points to a missing section",
      detail: `${affectedSectionId} is not present in the compiled V2 page.`,
      category: "quality_failed",
      severity: "blocking"
    });
  }

  if (artifact.status === "rejected") {
    blockers.push({
      id: "v2_diff_rejected_artifact",
      title: "Rejected copy cannot be proposed",
      detail: `${artifact.id} was marked rejected by the copy evaluator.`,
      category: "quality_failed",
      severity: "blocking"
    });
  }

  if (artifact.claimSpans.some((span) => span.renderPolicy !== "durable_render" || span.sourcePolicy !== "durable_render")) {
    blockers.push({
      id: "v2_diff_non_renderable_claim",
      title: "Copy diff contains a non-renderable claim",
      detail: `${artifact.id} includes claim spans that are not durable-render safe.`,
      category: "policy_review_required",
      severity: "blocking"
    });
  }

  return blockers;
}
