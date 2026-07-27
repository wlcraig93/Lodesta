import type {
  ProspectReportAccessPolicy,
  ProspectReportRecord,
  WebsiteAssessmentJob
} from "@/packages/platform-operations";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import {
  classifyProspectWebsite,
  consumeProspectBudget,
  noOwnedWebsiteProspectReport,
  recentProspectReportCutoff,
  resolveProspectBusiness,
  withProspectScanSlot
} from "@/packages/acquisition/prospect-reports";
import {
  websiteAssessmentRubricIdentity,
  websiteAssessmentScannerIdentity
} from "@/packages/website-assessment/rubric";
import { websiteAssessmentRecordIsCurrent } from "@/packages/website-assessment/service";

export class ProspectReportGenerationError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string
  ) {
    super(publicMessage);
    this.name = "ProspectReportGenerationError";
  }
}

export async function createOrReuseProspectReport(input: {
  query: string;
  accessPolicy: ProspectReportAccessPolicy;
}): Promise<{
  report: ProspectReportRecord;
  reused: boolean;
  job?: WebsiteAssessmentJob;
}> {
  if (!consumeProspectBudget("prospect_scan")) {
    throw new ProspectReportGenerationError(
      429,
      "Website Health Report checks are temporarily at capacity. Try again later."
    );
  }

  let resolution;
  try {
    resolution = await withProspectScanSlot(() => resolveProspectBusiness({ query: input.query }));
  } catch {
    throw new ProspectReportGenerationError(502, "Unable to resolve the selected business.");
  }
  if (!resolution.usMarket) {
    throw new ProspectReportGenerationError(400, "Lodesta reports are currently limited to US businesses.");
  }

  const reusable = await repository.findReusableProspectReportBySourceKey(
    resolution.sourceKey,
    input.accessPolicy,
    recentProspectReportCutoff()
  );
  if (reusable && await prospectReportUsesCurrentAssessment(reusable)) {
    return { report: reusable, reused: true };
  }
  const active = await repository.findActiveProspectReportBySourceKey(
    resolution.sourceKey,
    input.accessPolicy
  );
  if (active && await prospectReportUsesCurrentAssessment(active)) {
    return { report: active, reused: true };
  }

  const website = resolution.website ?? classifyProspectWebsite(undefined);
  let report;
  try {
    report = await repository.createProspectReport({
      sourceKey: resolution.sourceKey,
      accessPolicy: input.accessPolicy,
      sourceUrl: website.kind === "owned_website" ? website.url : undefined,
      sourceHost: website.host,
      websiteKind: website.kind,
      businessStrength: resolution.businessStrength,
      resolutionUsage: resolution.usage
    });
  } catch {
    const concurrent = await repository.findActiveProspectReportBySourceKey(
      resolution.sourceKey,
      input.accessPolicy
    );
    if (!concurrent) {
      throw new ProspectReportGenerationError(500, "Unable to create the report.");
    }
    return { report: concurrent, reused: true };
  }

  if (website.kind !== "owned_website" || !website.url) {
    report = (await repository.updateProspectReport({
      reportId: report.id,
      status: "completed",
      result: noOwnedWebsiteProspectReport({
        websiteKind: website.kind === "owned_website" ? "no_website" : website.kind,
        businessName: resolution.displayName,
        sourceUrl: website.url,
        sourceHost: website.host
      }),
      completedAt: new Date().toISOString()
    })) ?? report;
    return { report, reused: false };
  }

  const assessment = await repository.createWebsiteAssessment({
    targetKind: "public_url",
    sourceKey: resolution.sourceKey,
    sourceUrl: website.url,
    rubricIdentity: websiteAssessmentRubricIdentity,
    scannerIdentity: websiteAssessmentScannerIdentity
  });
  report = (await repository.updateProspectReport({
    reportId: report.id,
    assessmentId: assessment.id
  })) ?? report;
  const job = await repository.enqueueWebsiteAssessmentJob({
    assessmentId: assessment.id,
    prospectReportId: report.id
  });
  return { report, reused: false, job };
}

export async function prospectReportUsesCurrentAssessment(report: Pick<
  ProspectReportRecord,
  "websiteKind" | "assessmentId"
>) {
  if (report.websiteKind !== "owned_website") return true;
  if (!report.assessmentId) return false;
  const assessment = await repository.getWebsiteAssessment(report.assessmentId);
  return Boolean(assessment && websiteAssessmentRecordIsCurrent(assessment));
}
