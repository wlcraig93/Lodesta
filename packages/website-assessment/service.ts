import { configuredAppOrigin } from "@/lib/app-origin";
import { platformOperationsRepository } from "@/packages/platform-operations";
import type { PlatformSiteRecord, SiteBuildArtifact, SiteVersion } from "@/packages/site-contracts";
import type { PlatformOperationsRepository, WebsiteAssessmentRecord } from "@/packages/platform-operations";
import { agentReadinessMethodologyIdentity } from "./agent-readiness";
import {
  currentVisualQualityEvaluatorIdentity,
  visualQualityMethodologyIdentity
} from "./visual-quality";
import {
  websiteAssessmentRubricIdentity,
  websiteAssessmentScannerIdentity
} from "./rubric";

export function websiteAssessmentRecordIsCurrent(record: WebsiteAssessmentRecord) {
  return record.rubricIdentity === websiteAssessmentRubricIdentity
    && record.scannerIdentity === websiteAssessmentScannerIdentity
    && (record.status !== "completed"
      || Boolean(record.assessment
        && record.assessment.agentReadiness.methodologyIdentity === agentReadinessMethodologyIdentity
        && record.assessment.visualQuality.methodologyIdentity === visualQualityMethodologyIdentity
        && record.assessment.visualQuality.evaluator.identity === currentVisualQualityEvaluatorIdentity()));
}

export async function enqueueSiteArtifactAssessment(input: {
  artifact: SiteBuildArtifact;
  versionId?: string;
}) {
  try {
    const sourceKey = `artifact:${input.artifact.id}`;
    const existing = (await platformOperationsRepository.listWebsiteAssessments({
      sourceKey,
      limit: 20
    })).find((candidate) => candidate.status !== "failed" && websiteAssessmentRecordIsCurrent(candidate));
    if (existing) return { assessment: existing };
    const assessment = await platformOperationsRepository.createWebsiteAssessment({
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

export async function enqueuePublishedSiteAssessment(input: {
  site: PlatformSiteRecord;
  version: SiteVersion;
  repository?: Pick<
    PlatformOperationsRepository,
    "listDomains" | "listWebsiteAssessments" | "createWebsiteAssessment" | "enqueueWebsiteAssessmentJob"
  >;
}) {
  try {
    const repository = input.repository ?? platformOperationsRepository;
    const sourceUrl = await authoritativePublishedUrl(input.site, repository);
    if (!sourceUrl) {
      console.warn(JSON.stringify({
        event: "published_site_assessment_enqueue_skipped",
        siteId: input.site.id,
        versionId: input.version.id,
        reason: "public_origin_unavailable"
      }));
      return undefined;
    }
    const sourceKey = `published:${input.version.id}`;
    const existing = (await repository.listWebsiteAssessments({
      sourceKey,
      limit: 20
    })).find((candidate) => candidate.status !== "failed" && websiteAssessmentRecordIsCurrent(candidate));
    if (existing) return { assessment: existing };
    const assessment = await repository.createWebsiteAssessment({
      targetKind: "published_site",
      sourceKey,
      sourceUrl,
      siteId: input.site.id,
      artifactId: input.version.artifactId,
      versionId: input.version.id,
      rubricIdentity: websiteAssessmentRubricIdentity,
      scannerIdentity: websiteAssessmentScannerIdentity
    });
    const job = await repository.enqueueWebsiteAssessmentJob({
      assessmentId: assessment.id
    });
    return { assessment, job };
  } catch (error) {
    console.warn(JSON.stringify({
      event: "published_site_assessment_enqueue_failed",
      siteId: input.site.id,
      versionId: input.version.id,
      error: error instanceof Error ? error.message : String(error)
    }));
    return undefined;
  }
}

async function authoritativePublishedUrl(
  site: PlatformSiteRecord,
  repository: Pick<PlatformOperationsRepository, "listDomains">
) {
  const domains = await repository.listDomains(site.id);
  const activeDomain = domains.find((domain) =>
    domain.status === "active"
    && domain.ownershipProofStatus === "verified"
    && domain.routingStatus === "active"
    && domain.providerStatus === "active"
    && domain.certificateStatus === "active"
  );
  if (activeDomain) return `https://${activeDomain.hostname}/`;
  const origin = configuredAppOrigin();
  return origin ? `${origin}/sites/${site.slug}` : undefined;
}
