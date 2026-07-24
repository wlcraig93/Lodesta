import { platformOperationsRepository } from "@/packages/platform-operations";
import type { SiteBuildArtifact } from "@/packages/site-contracts";
import {
  websiteAssessmentRubricIdentity,
  websiteAssessmentScannerIdentity
} from "./rubric";

export async function enqueueSiteArtifactAssessment(input: {
  artifact: SiteBuildArtifact;
  versionId?: string;
}) {
  try {
    const sourceKey = `artifact:${input.artifact.id}`;
    const existing = (await platformOperationsRepository.listWebsiteAssessments({
      sourceKey,
      limit: 1
    }))[0];
    if (existing) return { assessment: existing };
    const assessment = await platformOperationsRepository.createWebsiteAssessment({
      id: `website_assessment_${input.artifact.id}`,
      targetKind: "site_artifact",
      sourceKey,
      siteId: input.artifact.siteId,
      artifactId: input.artifact.id,
      versionId: input.versionId,
      rubricIdentity: websiteAssessmentRubricIdentity,
      scannerIdentity: websiteAssessmentScannerIdentity
    });
    const job = await platformOperationsRepository.enqueueWebsiteAssessmentJob({
      assessmentId: assessment.id
    });
    return { assessment, job };
  } catch (error) {
    console.warn(JSON.stringify({
      event: "site_artifact_assessment_enqueue_failed",
      artifactId: input.artifact.id,
      siteId: input.artifact.siteId,
      error: error instanceof Error ? error.message : String(error)
    }));
    return undefined;
  }
}
