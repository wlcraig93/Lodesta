import { sitePlatformRepository } from "@/packages/platform-data";
import {
  platformOperationsRepository,
  type PlatformOperationsRepository,
  type WebsiteAssessmentRecord
} from "@/packages/platform-operations";
import {
  prospectReportFromAssessment,
  withProspectScanSlot
} from "@/packages/acquisition/prospect-reports";
import { assessPublicUrl } from "./public-url-adapter";
import { assessSiteArtifact } from "./site-artifact-adapter";
import type { WebsiteAssessment } from "./contracts";
import { persistWebsiteAssessmentEvidence } from "./evidence-storage";

type AssessmentJobRepository = Pick<
  PlatformOperationsRepository,
  | "claimNextWebsiteAssessmentJob"
  | "getWebsiteAssessment"
  | "updateWebsiteAssessment"
  | "completeWebsiteAssessmentJob"
  | "failWebsiteAssessmentJob"
  | "getProspectReport"
  | "updateProspectReport"
>;

export type WebsiteAssessmentJobResult = {
  jobId: string;
  assessmentId: string;
  prospectReportId?: string;
  status: "completed" | "queued" | "failed";
  error?: string;
};

export async function processNextWebsiteAssessmentJob(input: {
  workerId?: string;
  repository?: AssessmentJobRepository;
  runAssessment?: (record: WebsiteAssessmentRecord) => Promise<WebsiteAssessment>;
} = {}): Promise<WebsiteAssessmentJobResult | null> {
  const repository = input.repository ?? platformOperationsRepository;
  const workerId = input.workerId ?? `website-assessment-${process.pid}`;
  const job = await repository.claimNextWebsiteAssessmentJob(workerId);
  if (!job) return null;
  try {
    const record = await repository.getWebsiteAssessment(job.assessmentId);
    if (!record) throw new Error("Website assessment record not found.");
    let assessment = record.assessment;
    if (record.status !== "completed" || !assessment) {
      await repository.updateWebsiteAssessment({ assessmentId: record.id, status: "running", clearError: true });
      if (job.prospectReportId) {
        const report = await repository.getProspectReport(job.prospectReportId);
        if (!report) throw new Error("Linked prospect report record not found.");
        if (report.status !== "completed") {
          await repository.updateProspectReport({
            reportId: report.id,
            status: "running",
            assessmentId: record.id,
            clearError: true
          });
        }
      }
      const runAssessment = input.runAssessment ?? runAssessmentForRecord;
      const generatedAssessment = record.targetKind === "site_artifact"
        ? await runAssessment(record)
        : await withProspectScanSlot(() => runAssessment(record));
      assertAssessmentIdentity(generatedAssessment, record);
      assessment = await persistWebsiteAssessmentEvidence({ assessment: generatedAssessment });
      await repository.updateWebsiteAssessment({
        assessmentId: record.id,
        status: "completed",
        assessment,
        clearError: true,
        completedAt: new Date().toISOString()
      });
    }
    if (job.prospectReportId) {
      const report = await repository.getProspectReport(job.prospectReportId);
      if (!report) throw new Error("Linked prospect report record not found.");
      if (report.status !== "completed") {
        await repository.updateProspectReport({
          reportId: report.id,
          status: "completed",
          assessmentId: assessment.id,
          clearError: true,
          result: prospectReportFromAssessment(assessment, {
            websiteKind: report.websiteKind,
            sourceHost: report.sourceHost
          }),
          completedAt: new Date().toISOString()
        });
      }
    }
    await repository.completeWebsiteAssessmentJob(job.id);
    return {
      jobId: job.id,
      assessmentId: record.id,
      prospectReportId: job.prospectReportId,
      status: "completed"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = job.attempts < job.maxAttempts ? "queued" : "failed";
    const currentAssessment = await repository.getWebsiteAssessment(job.assessmentId).catch(() => null);
    if (currentAssessment?.status !== "completed") {
      await repository.updateWebsiteAssessment({
        assessmentId: job.assessmentId,
        status,
        errorCode: message.slice(0, 160)
      });
    }
    if (job.prospectReportId) {
      const currentReport = await repository.getProspectReport(job.prospectReportId).catch(() => null);
      if (currentReport?.status !== "completed") {
        await repository.updateProspectReport({
          reportId: job.prospectReportId,
          status,
          errorCode: message.slice(0, 160)
        });
      }
    }
    await repository.failWebsiteAssessmentJob(job.id, message);
    return {
      jobId: job.id,
      assessmentId: job.assessmentId,
      prospectReportId: job.prospectReportId,
      status,
      error: message
    };
  }
}

function assertAssessmentIdentity(assessment: WebsiteAssessment, record: WebsiteAssessmentRecord) {
  const mismatches = [
    assessment.id !== record.id ? "id" : undefined,
    assessment.target.kind !== record.targetKind ? "target.kind" : undefined,
    assessment.target.sourceKey !== record.sourceKey ? "target.sourceKey" : undefined,
    assessment.producer.rubricIdentity !== record.rubricIdentity ? "producer.rubricIdentity" : undefined,
    assessment.producer.scannerIdentity !== record.scannerIdentity ? "producer.scannerIdentity" : undefined,
    record.siteId !== undefined && assessment.target.siteId !== record.siteId ? "target.siteId" : undefined,
    record.artifactId !== undefined && assessment.target.artifactId !== record.artifactId ? "target.artifactId" : undefined,
    record.versionId !== undefined && assessment.target.versionId !== record.versionId ? "target.versionId" : undefined
  ].filter((value): value is string => Boolean(value));
  if (mismatches.length) {
    throw new Error(`Generated website assessment identity does not match its immutable operational record: ${mismatches.join(", ")}.`);
  }
}

export async function processWebsiteAssessmentJobs(input: {
  limit?: number;
  workerId?: string;
  repository?: AssessmentJobRepository;
  runAssessment?: (record: WebsiteAssessmentRecord) => Promise<WebsiteAssessment>;
} = {}) {
  const limit = Math.max(1, Math.min(input.limit ?? 4, 4));
  const results: WebsiteAssessmentJobResult[] = [];
  for (let index = 0; index < limit; index += 1) {
    const result = await processNextWebsiteAssessmentJob({
      workerId: `${input.workerId ?? `website-assessment-recovery-${process.pid}`}-${index + 1}`,
      repository: input.repository,
      runAssessment: input.runAssessment
    });
    if (!result) break;
    results.push(result);
  }
  return results;
}

async function runAssessmentForRecord(record: WebsiteAssessmentRecord) {
  if ((record.targetKind === "public_url" || record.targetKind === "published_site") && record.sourceUrl) {
    const canonicalBuildInput = record.targetKind === "published_site" && record.artifactId
      ? await (async () => {
          const artifact = await sitePlatformRepository.getBuildArtifact(record.artifactId!);
          if (!artifact) return undefined;
          return await sitePlatformRepository.getPublicBuildInput(artifact.publicBuildInputId) ?? undefined;
        })()
      : undefined;
    return (await assessPublicUrl({
      url: record.sourceUrl,
      assessmentId: record.id,
      sourceKey: record.sourceKey,
      captureScreenshots: true,
      targetKind: record.targetKind,
      siteId: record.siteId,
      versionId: record.versionId,
      canonicalBuildInput
    })).assessment;
  }
  if (record.targetKind === "site_artifact" && record.artifactId) {
    const artifact = await sitePlatformRepository.getBuildArtifact(record.artifactId);
    if (!artifact) throw new Error("Site build artifact not found.");
    const buildInput = await sitePlatformRepository.getPublicBuildInput(artifact.publicBuildInputId);
    if (!buildInput) throw new Error("Site public build input not found.");
    return await assessSiteArtifact({
      artifact,
      buildInput,
      versionId: record.versionId,
      assessmentId: record.id
    });
  }
  throw new Error(`Unsupported or incomplete assessment target: ${record.targetKind}.`);
}
