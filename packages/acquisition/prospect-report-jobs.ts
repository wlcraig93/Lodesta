import {
  platformOperationsRepository,
  type PlatformOperationsRepository,
  type ProspectPresenceReportResult,
  type ProspectReportRecord
} from "@/packages/platform-operations";
import { runProspectPresenceReport } from "./prospect-reports";

type ProspectJobRepository = Pick<
  PlatformOperationsRepository,
  | "claimNextProspectReportJob"
  | "getProspectReport"
  | "updateProspectReport"
  | "completeProspectReportJob"
  | "failProspectReportJob"
>;

export type ProspectReportJobResult = {
  jobId: string;
  reportId: string;
  status: "completed" | "queued" | "failed";
  error?: string;
};

export async function processNextProspectReportJob(input: {
  workerId?: string;
  repository?: ProspectJobRepository;
  runReport?: (report: ProspectReportRecord) => Promise<ProspectPresenceReportResult>;
} = {}): Promise<ProspectReportJobResult | null> {
  const repository = input.repository ?? platformOperationsRepository;
  const workerId = input.workerId ?? `prospect-web-${process.pid}`;
  const job = await repository.claimNextProspectReportJob(workerId);
  if (!job) return null;
  try {
    const report = await repository.getProspectReport(job.reportId);
    if (!report) throw new Error("Prospect report record not found.");
    await repository.updateProspectReport({ reportId: report.id, status: "running", jobId: job.id });
    const result = await (input.runReport ?? runProspectPresenceReport)(report);
    await repository.updateProspectReport({
      reportId: report.id,
      status: "completed",
      result,
      completedAt: new Date().toISOString()
    });
    await repository.completeProspectReportJob(job.id);
    return { jobId: job.id, reportId: report.id, status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = job.attempts < job.maxAttempts ? "queued" : "failed";
    await repository.updateProspectReport({
      reportId: job.reportId,
      status,
      errorCode: message.slice(0, 160)
    });
    await repository.failProspectReportJob(job.id, message);
    return { jobId: job.id, reportId: job.reportId, status, error: message };
  }
}

export async function processProspectReportJobs(input: {
  limit?: number;
  workerId?: string;
  repository?: ProspectJobRepository;
  runReport?: (report: ProspectReportRecord) => Promise<ProspectPresenceReportResult>;
} = {}) {
  const limit = Math.max(1, Math.min(input.limit ?? 4, 4));
  const results: ProspectReportJobResult[] = [];
  for (let index = 0; index < limit; index += 1) {
    const result = await processNextProspectReportJob({
      workerId: `${input.workerId ?? `prospect-recovery-${process.pid}`}-${index + 1}`,
      repository: input.repository,
      runReport: input.runReport
    });
    if (!result) break;
    results.push(result);
  }
  return results;
}
