import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AnalyticsSummary,
  ClaimRecord,
  ExperimentAnalysis,
  ExperimentLearning,
  Inquiry,
  InquiryEvent,
  JobKind,
  JobRecord,
  WorkerHeartbeatRecord,
  OptimizationFinding,
  ProspectReportRecord,
  SiteBundle,
  SiteVersion
} from "./models";
import { sendOwnerOperationalEmail } from "./owner-notifications";
import { createSiteV3FromInput } from "./intake";
import { runAudit } from "./audit";
import { createPresenceIntakePlan } from "./presence-intake";
import { runProspectPresenceReport } from "./prospect-reports";
import { runUrlPresenceAssessment } from "./presence-assessment-runner";
import { runSiteQa } from "./qa";
import { assertPublicFetchUrl } from "./url-safety";
import { assertLaunchMarket } from "./launch-market";
import { getProcessWorkerId, warnIfDeprecatedWorkerIdEnvSet } from "./worker-identity";
import type { GenerateSiteOptions, GenerateSiteResult } from "./site-candidate-service";
import { assertSiteVersionV3, pageCountForVersionV3 } from "./site-version-v3";
import { generateSiteTimeoutMs, generationTimeoutSignal } from "./generation-timeout";
import {
  generationFailureDetail,
  isRetryableGenerationFailure,
  serializeGenerationFailure
} from "./generation-failure";
import { setWorkerCurrentJob } from "./worker-runtime";

const jobsFile = join(process.cwd(), ".data", "jobs.json");
const workerHeartbeatsFile = join(process.cwd(), ".data", "worker-heartbeats.json");
export const defaultJobMaxAttempts = 3;
export const defaultJobStaleAfterMs = 1000 * 60 * 15;
export const defaultJobHeartbeatMs = 60_000;

export type JobHeartbeatResult = { status: "ok" | "lock_lost" };

export class JobLockLostError extends Error {
  constructor(jobId: string, workerId: string) {
    super(`Job ${jobId} lock was lost for worker ${workerId}; aborting active work.`);
    this.name = "JobLockLostError";
  }
}

type JobsFile = {
  jobs: JobRecord[];
};

export type JobExecutionContext = {
  workerId?: string;
  signal?: AbortSignal;
  heartbeatJob?: (jobId: string, workerId: string) => Promise<JobHeartbeatResult>;
  generateSite?: (options: Omit<GenerateSiteOptions, "repository">) => Promise<GenerateSiteResult>;
  getSiteBundle?: (siteId: string) => Promise<SiteBundle | null>;
  runAndStoreAudit?: (siteId: string) => Promise<OptimizationFinding[] | null>;
  analyticsSummary?: (siteId: string) => Promise<AnalyticsSummary>;
  analyzeExperiments?: (siteId: string) => Promise<ExperimentAnalysis[]>;
  listExperimentLearnings?: (siteId?: string) => Promise<ExperimentLearning[]>;
  listInquiries?: (siteId?: string) => Promise<Inquiry[]>;
  listClaims?: (siteId?: string) => Promise<ClaimRecord[]>;
  listInquiryEvents?: (inquiryId: string) => Promise<InquiryEvent[]>;
  processInquiryNotification?: (input: { siteId: string; inquiryId: string }) => Promise<Record<string, unknown>>;
  processInquiryAiEnrichment?: (input: { siteId: string; inquiryId: string }) => Promise<Record<string, unknown>>;
  getProspectReport?: (reportId: string) => Promise<ProspectReportRecord | null>;
  updateProspectReport?: (input: {
    reportId: string;
    status?: ProspectReportRecord["status"];
    jobId?: string;
    sourceUrl?: string;
    sourceHost?: string;
    websiteKind?: ProspectReportRecord["websiteKind"];
    result?: ProspectReportRecord["result"];
    unlockedAt?: string;
    leadId?: string;
    errorCode?: string;
    completedAt?: string;
  }) => Promise<ProspectReportRecord | null>;
  cleanupAgentTelemetry?: (input?: { olderThanDays?: number; limit?: number }) => Promise<{ deleted: number; cutoff: string }>;
};

export async function enqueueJob(kind: JobKind, payload: Record<string, unknown>) {
  const file = await readJobsFile();
  const now = new Date().toISOString();
  const job: JobRecord = {
    id: crypto.randomUUID(),
    kind,
    status: "queued",
    payload,
    attempts: 0,
    maxAttempts: maxAttemptsFromPayload(payload),
    runAfter: runAfterFromPayload(payload, now),
    createdAt: now,
    updatedAt: now
  };
  file.jobs.push(job);
  await writeJobsFile(file);
  return job;
}

export async function listJobs(status?: JobRecord["status"]) {
  const file = await readJobsFile();
  return status ? file.jobs.filter((job) => job.status === status) : file.jobs;
}

export async function getJob(id: string) {
  const file = await readJobsFile();
  return file.jobs.find((job) => job.id === id) ?? null;
}

export async function heartbeatLocalJob(jobId: string, workerId: string): Promise<JobHeartbeatResult> {
  const file = await readJobsFile();
  const job = file.jobs.find((candidate) => candidate.id === jobId);
  if (!job || job.status !== "running" || job.lockedBy !== workerId) return { status: "lock_lost" };
  const now = new Date().toISOString();
  job.lockedAt = now;
  job.updatedAt = now;
  await writeJobsFile(file);
  return { status: "ok" };
}

export async function processNextJob(context?: JobExecutionContext) {
  warnIfDeprecatedWorkerIdEnvSet();
  const file = await readJobsFile();
  if (requeueStaleLocalJobs(file, Date.now())) await writeJobsFile(file);
  const nowMs = Date.now();
  const job = file.jobs.find((candidate) => candidate.status === "queued" && new Date(candidate.runAfter).getTime() <= nowMs);
  if (!job) return null;
  const workerId = context?.workerId ?? getProcessWorkerId();

  job.status = "running";
  job.attempts += 1;
  job.startedAt = new Date().toISOString();
  job.lockedAt = job.startedAt;
  job.lockedBy = workerId;
  job.updatedAt = job.startedAt;
  await writeJobsFile(file);

  const runtimeContext: JobExecutionContext = { ...context, workerId, heartbeatJob: context?.heartbeatJob ?? heartbeatLocalJob };
  try {
    setWorkerCurrentJob(job);
    const result = await executeJob(job, runtimeContext);
    await updateJob(job.id, {
      status: "completed",
      result,
      completedAt: new Date().toISOString()
    });
    return await getJob(job.id);
  } catch (error) {
    await failOrRetryLocalJob(job.id, error);
    return await getJob(job.id);
  } finally {
    setWorkerCurrentJob(undefined);
  }
}

export async function processAllQueuedJobs(limit = 25, context?: JobExecutionContext) {
  const processed: JobRecord[] = [];
  for (let index = 0; index < limit; index += 1) {
    const job = await processNextJob(context);
    if (!job) break;
    processed.push(job);
  }
  return processed;
}

export async function executeJob(job: JobRecord, context?: JobExecutionContext): Promise<Record<string, unknown>> {
  const workerId = context?.workerId ?? getProcessWorkerId();
  const lockController = new AbortController();
  const signal = context?.signal ? AbortSignal.any([context.signal, lockController.signal]) : lockController.signal;
  const runtimeContext: JobExecutionContext = { ...context, workerId, signal };
  const heartbeat = startJobHeartbeat(job.id, runtimeContext, lockController);
  try {
    return await executeJobBody(job, runtimeContext, lockController);
  } finally {
    heartbeat.stop();
  }
}

async function executeJobBody(
  job: JobRecord,
  context: JobExecutionContext,
  lockController: AbortController
): Promise<Record<string, unknown>> {
  switch (job.kind) {
    case "presence_assessment": {
      const run = await runUrlPresenceAssessment({
        url: assertString(job.payload.url, "url"),
        captureScreenshots: job.payload.screenshots !== false,
        publicPresence: "google_places"
      });
      const { url, crawl, renderInspection, publicPresence } = run;
      return createPresenceIntakePlan(url, crawl, renderInspection, publicPresence) as unknown as Record<string, unknown>;
    }
    case "prospect_presence_report": {
      const reportId = assertString(job.payload.reportId, "reportId");
      if (!context?.getProspectReport || !context.updateProspectReport) {
        throw new Error("prospect_presence_report requires repository-backed job context.");
      }
      const report = await context.getProspectReport(reportId);
      if (!report) throw new Error("Unknown prospect report.");
      if (report.status === "completed" && report.result) {
        return { reportId, status: "completed", reused: true, websiteKind: report.websiteKind };
      }
      await context.updateProspectReport({ reportId, status: "running", jobId: job.id });
      try {
        const result = await runProspectPresenceReport(report);
        const completedAt = new Date().toISOString();
        await context.updateProspectReport({
          reportId,
          status: "completed",
          sourceUrl: result.sourceUrl,
          sourceHost: result.sourceHost,
          websiteKind: result.websiteKind,
          result,
          completedAt
        });
        return {
          reportId,
          status: "completed",
          websiteKind: result.websiteKind,
          overallScore: result.overallScore
        };
      } catch (error) {
        await context.updateProspectReport({
          reportId,
          status: "failed",
          errorCode: "scan_failed"
        });
        throw new Error(`Prospect report scan failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
    case "generate_site": {
      if (!context?.generateSite) {
        throw new Error("generate_site requires the canonical site-candidate service.");
      }
      const rawUrl = typeof job.payload.url === "string" ? job.payload.url : undefined;
      const prompt = typeof job.payload.prompt === "string" ? job.payload.prompt : undefined;
      const candidatePurpose = job.payload.candidatePurpose === "test_generation" ? "test_generation" : undefined;
      const modelFallbackPolicy = job.payload.modelFallbackPolicy === "allow" ? "allow" : undefined;
      const url = rawUrl ? await assertPublicFetchUrl(rawUrl) : undefined;
      assertLaunchMarket({ url, prompt });
      const input = {
        url,
        prompt
      };
      const timeout = generationSignalForJob(job, context, lockController, url ?? prompt ?? "generate_site");
      let generation: GenerateSiteResult;
      try {
        generation = await context.generateSite({
          input,
          source: "job",
          candidatePurpose,
          modelFallbackPolicy,
          metadata: jobGenerationMetadata(job, context),
          signal: timeout.signal
        });
      } finally {
        timeout.clear();
      }
      const bundle = generation.bundle;
      const version = bundle.siteModel.versions[0];
      return {
        runId: generation.runId,
        siteCandidateId: generation.siteCandidateId,
        candidateSiteId: bundle.businessProfile.siteId,
        candidateSlug: bundle.siteModel.slug,
        businessName: bundle.businessProfile.name,
        vertical: bundle.businessProfile.vertical,
        rendererVersion: version?.rendererVersion,
        readiness: version?.generationQa?.readiness,
        pages: versionPageCount(version),
        findings: bundle.optimizationFindings.length
      };
    }
    case "agent_telemetry_cleanup": {
      if (!context?.cleanupAgentTelemetry) {
        return {
          deleted: 0,
          skipped: "Telemetry cleanup requires repository-backed job context."
        };
      }
      const olderThanDays = typeof job.payload.olderThanDays === "number" ? job.payload.olderThanDays : 30;
      const limit = typeof job.payload.limit === "number" ? job.payload.limit : 1000;
      return context.cleanupAgentTelemetry({ olderThanDays, limit });
    }
    case "import_batch": {
      if (!context?.generateSite) {
        throw new Error("import_batch requires the canonical site-candidate service.");
      }
      const urls = parseBatchUrls(job.payload.urls ?? job.payload.text);
      if (urls.length === 0) throw new Error("import_batch requires at least one URL");
      const prompt = typeof job.payload.prompt === "string" ? job.payload.prompt : undefined;
      const createPreviews = job.payload.createPreviews !== false;
      const results = [];

      for (const url of urls) {
        await heartbeatJobOrWarn(job.id, context, lockController);
        const timeout = generationSignalForJob(job, context, lockController, url);
        try {
          const generation = await context.generateSite({
            input: { url, prompt },
            source: "job",
            metadata: {
              ...jobGenerationMetadata(job, context),
              importBatchJobId: job.id
            },
            preview: {
              create: createPreviews
            },
            signal: timeout.signal
          });
          timeout.clear();
          const bundle = generation.bundle;
          results.push({
            ok: true,
            url,
            runId: generation.runId,
            siteCandidateId: generation.siteCandidateId,
            candidateSiteId: bundle.businessProfile.siteId,
            candidateSlug: bundle.siteModel.slug,
            vertical: bundle.businessProfile.vertical,
            pages: pageCountForVersionV3(assertSiteVersionV3(bundle.siteModel.versions[0]))
          });
        } catch (error) {
          timeout.clear();
          if (error instanceof JobLockLostError) throw error;
          results.push({
            ok: false,
            url,
            error: error instanceof Error ? error.message : "Unknown import error"
          });
        }
      }

      return {
        generatedAt: new Date().toISOString(),
        total: urls.length,
        created: results.filter((result) => result.ok).length,
        failed: results.filter((result) => !result.ok).length,
        results
      };
    }
    case "audit_site": {
      const siteId = typeof job.payload.siteId === "string" ? job.payload.siteId : undefined;
      if (siteId && context?.runAndStoreAudit && context?.getSiteBundle) {
        const findings = await context.runAndStoreAudit(siteId);
        const bundle = await context.getSiteBundle(siteId);
        if (!findings || !bundle) throw new Error(`Unknown site: ${siteId}`);
        const qa = runSiteQa(bundle, { versionStatus: "draft" });
        return {
          siteId,
          slug: bundle.siteModel.slug,
          findings,
          qa: qaSummary(qa)
        };
      }
      const inputUrl = typeof job.payload.url === "string" ? job.payload.url : undefined;
      const bundle = createSiteV3FromInput({
        url: inputUrl,
        prompt: assertString(job.payload.prompt ?? "Build a website for Sample Local Business", "prompt")
      });
      const findings = runAudit(bundle.businessProfile, bundle.siteModel);
      return {
        siteId: bundle.businessProfile.siteId,
        findings
      };
    }
    case "monthly_action_list": {
      const siteId = assertString(job.payload.siteId, "siteId");
      if (!context?.getSiteBundle || !context.runAndStoreAudit || !context.analyticsSummary || !context.analyzeExperiments) {
        throw new Error("monthly_action_list requires repository-backed job context");
      }
      const bundle = await context.getSiteBundle(siteId);
      if (!bundle) throw new Error(`Unknown site: ${siteId}`);
      const [findings, analytics, experiments, learnings, inquiries, claims] = await Promise.all([
        context.runAndStoreAudit(siteId),
        context.analyticsSummary(siteId),
        context.analyzeExperiments(siteId),
        context.listExperimentLearnings?.(siteId) ?? Promise.resolve([]),
        context.listInquiries?.(siteId) ?? Promise.resolve([]),
        context.listClaims?.(siteId) ?? Promise.resolve([])
      ]);
      const qa = runSiteQa(bundle, { versionStatus: "draft" });
      const openFindings = (findings ?? []).filter((finding) => finding.status === "open");
      const autoApplicable = openFindings.filter((finding) => finding.applyMode !== "manual_service");
      const proposalCount = openFindings.length;
      const proposalNotification = proposalCount
        ? await sendOwnerOperationalEmail({
            bundle,
            claims,
            kind: "proposal_ready",
            subject: `${bundle.businessProfile.name}: ${proposalCount} website improvement proposal${
              proposalCount === 1 ? "" : "s"
            } ready`,
            summaryLines: [
              ...(openFindings.length
                ? [
                    `${openFindings.length} open action-list proposal${
                      openFindings.length === 1 ? "" : "s"
                    } are waiting in the action list.`,
                    `${autoApplicable.length} can be drafted with one-click or auto-fix controls.`
                  ]
                : []),
              ...openFindings.slice(0, 3).map((finding) => `- ${finding.title}`)
            ],
            actionPath: `/optimization/${bundle.siteModel.slug}`
          })
        : {
            kind: "proposal_ready" as const,
            siteId,
            status: "skipped" as const,
            message: "No open proposals were generated."
          };
      const inquiryDigestNotification = inquiries.length
        ? await sendOwnerOperationalEmail({
            bundle,
            claims,
            kind: "inquiry_digest",
            subject: `${bundle.businessProfile.name}: ${inquiries.length} recent site lead${inquiries.length === 1 ? "" : "s"}`,
            summaryLines: [
              `${inquiries.length} inquiry record${inquiries.length === 1 ? "" : "s"} are visible in Lodesta.`,
              ...summarizeInquiries(inquiries).recent
                .slice(0, 3)
                .map((inquiry) => `- ${inquiry.contactEmail ?? inquiry.status ?? inquiry.id}`)
            ],
            actionPath: `/leads/${bundle.siteModel.slug}`
          })
        : {
            kind: "inquiry_digest" as const,
            siteId,
            status: "skipped" as const,
            message: "No inquiries are available for a digest."
          };
      return {
        generatedAt: new Date().toISOString(),
        siteId,
        slug: bundle.siteModel.slug,
        analytics: {
          sessions: analytics.sessions,
          primaryActions: analytics.primaryActions,
          actionRate: analytics.actionRate,
          avgScrollDepth: analytics.avgScrollDepth,
          medianTimeToActionMs: analytics.medianTimeToActionMs
        },
        leads: inquiries.length,
        leadSummary: summarizeInquiries(inquiries),
        qa: qaSummary(qa),
        findings: {
          total: findings?.length ?? 0,
          open: openFindings.length,
          autoApplicable: autoApplicable.length,
          critical: openFindings.filter((finding) => finding.severity === "critical").length,
          top: openFindings.slice(0, 5).map((finding) => ({
            id: finding.id,
            title: finding.title,
            applyMode: finding.applyMode,
            expectedOutcomeMetric: finding.expectedOutcomeMetric
          }))
        },
        notifications: {
          proposalReady: proposalNotification,
          inquiryDigest: inquiryDigestNotification
        },
        experiments: experiments.map((analysis) => ({
          experimentId: analysis.experimentId,
          status: analysis.status,
          confidence: analysis.confidence,
          leaderLabel: analysis.leaderLabel,
          totalAssignments: analysis.totalAssignments
        })),
        learnings: {
          active: learnings.filter((learning) => learning.status === "active").length,
          rolledBack: learnings.filter((learning) => learning.status === "rolled_back").length
        }
      };
    }
    case "inquiry_notification": {
      const siteId = assertString(job.payload.siteId, "siteId");
      const inquiryId = assertString(job.payload.inquiryId, "inquiryId");
      if (!context?.processInquiryNotification) {
        throw new Error("inquiry_notification requires repository-backed job context");
      }
      return context.processInquiryNotification({ siteId, inquiryId });
    }
    case "inquiry_ai_enrichment": {
      const siteId = assertString(job.payload.siteId, "siteId");
      const inquiryId = assertString(job.payload.inquiryId, "inquiryId");
      if (!context?.processInquiryAiEnrichment) {
        throw new Error("inquiry_ai_enrichment requires repository-backed job context");
      }
      return context.processInquiryAiEnrichment({ siteId, inquiryId });
    }
    default:
      job.kind satisfies never;
      throw new Error(`Unsupported job kind: ${job.kind}`);
  }
}

function startJobHeartbeat(jobId: string, context: JobExecutionContext, lockController: AbortController) {
  if (!context.heartbeatJob || !context.workerId) return { stop: () => undefined };
  const interval = setInterval(() => {
    void heartbeatJobOrWarn(jobId, context, lockController).catch((error) => {
      if (!(error instanceof JobLockLostError)) {
        console.warn(`Job heartbeat failed for ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }, defaultJobHeartbeatMs);
  interval.unref?.();
  return {
    stop: () => clearInterval(interval)
  };
}

async function heartbeatJobOrWarn(jobId: string, context: JobExecutionContext, lockController: AbortController) {
  if (!context.heartbeatJob || !context.workerId || lockController.signal.aborted) return;
  try {
    const result = await context.heartbeatJob(jobId, context.workerId);
    if (result.status === "lock_lost") {
      const error = new JobLockLostError(jobId, context.workerId);
      lockController.abort(error);
      throw error;
    }
  } catch (error) {
    if (error instanceof JobLockLostError) throw error;
    console.warn(`Job heartbeat failed for ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function generationSignalForJob(job: JobRecord, context: JobExecutionContext, lockController: AbortController, label: string) {
  const timeoutMs = generateSiteTimeoutMs();
  const timeout = generationTimeoutSignal(timeoutMs, `job ${job.id} ${label}`);
  const signals = [timeout.signal, lockController.signal, context.signal].filter(Boolean) as AbortSignal[];
  return {
    signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    clear: timeout.clear
  };
}

function versionPageCount(version: SiteVersion | undefined) {
  if (!version) return 0;
  return pageCountForVersionV3(assertSiteVersionV3(version, "job version"));
}

function jobGenerationMetadata(job: JobRecord, context: JobExecutionContext) {
  return {
    ...asRecord(job.payload.metadata),
    jobId: job.id,
    workerId: context.workerId
  };
}

async function updateJob(id: string, patch: Partial<JobRecord>) {
  const file = await readJobsFile();
  const job = file.jobs.find((candidate) => candidate.id === id);
  if (!job) throw new Error(`Job not found: ${id}`);
  Object.assign(job, normalizeJobRecord({ ...job, ...patch, updatedAt: new Date().toISOString() }));
  await writeJobsFile(file);
}

async function failOrRetryLocalJob(id: string, error: unknown) {
  const file = await readJobsFile();
  const job = file.jobs.find((candidate) => candidate.id === id);
  if (!job) throw new Error(`Job not found: ${id}`);
  const message = error instanceof Error ? error.message : "Unknown job error";
  const detail = generationFailureDetail(error, {
    stage: "queued",
    code: "unknown_generation_failure",
    jobId: id
  });
  const retryable = isRetryableGenerationFailure(detail) && job.attempts < Math.min(job.maxAttempts, 2);
  const now = new Date().toISOString();
  if (retryable) {
    Object.assign(job, {
      status: "queued" as const,
      error: message,
      result: {
        ...job.result,
        generationFailureDetail: serializeGenerationFailure(detail)
      },
      runAfter: new Date(Date.now() + retryDelayMs(job.attempts)).toISOString(),
      lockedAt: undefined,
      lockedBy: undefined,
      updatedAt: now
    });
  } else {
    Object.assign(job, {
      status: "failed" as const,
      error: message,
      result: {
        ...job.result,
        generationFailureDetail: serializeGenerationFailure(detail)
      },
      completedAt: now,
      lockedAt: undefined,
      lockedBy: undefined,
      updatedAt: now
    });
  }
  await writeJobsFile(file);
}

function requeueStaleLocalJobs(file: JobsFile, nowMs: number) {
  let changed = false;
  for (const job of file.jobs) {
    if (job.status !== "running" || !job.lockedAt) continue;
    if (nowMs - new Date(job.lockedAt).getTime() <= defaultJobStaleAfterMs) continue;
    if (job.attempts >= job.maxAttempts) {
      job.status = "failed";
      job.error = job.error ?? "Job lock expired after all retry attempts.";
      job.completedAt = new Date(nowMs).toISOString();
    } else {
      job.status = "queued";
      job.error = job.error ?? "Job lock expired and was returned to the queue.";
      job.runAfter = new Date(nowMs).toISOString();
    }
    job.lockedAt = undefined;
    job.lockedBy = undefined;
    job.updatedAt = new Date(nowMs).toISOString();
    changed = true;
  }
  return changed;
}

async function readJobsFile(): Promise<JobsFile> {
  try {
    const raw = await readFile(jobsFile, "utf8");
    const parsed = JSON.parse(raw) as JobsFile;
    return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs.map(normalizeJobRecord) : [] };
  } catch {
    return { jobs: [] };
  }
}

async function writeJobsFile(file: JobsFile) {
  await mkdir(dirname(jobsFile), { recursive: true });
  await writeFile(jobsFile, `${JSON.stringify(file, null, 2)}\n`);
}

export async function recordLocalWorkerHeartbeat(heartbeat: WorkerHeartbeatRecord) {
  const file = await readWorkerHeartbeatsFile();
  const index = file.workers.findIndex((worker) => worker.workerId === heartbeat.workerId);
  if (index >= 0) {
    file.workers[index] = heartbeat;
  } else {
    file.workers.push(heartbeat);
  }
  await writeWorkerHeartbeatsFile(file);
  return heartbeat;
}

export async function listLocalWorkerHeartbeats() {
  return (await readWorkerHeartbeatsFile()).workers;
}

export async function requeueLocalJob(jobId: string) {
  const file = await readJobsFile();
  const job = file.jobs.find((candidate) => candidate.id === jobId);
  if (!job) return { ok: false as const, reason: "Job not found." };
  if (job.status !== "running") return { ok: false as const, reason: `Only running jobs can be requeued; current status is ${job.status}.` };
  const now = new Date().toISOString();
  job.status = "queued";
  job.runAfter = now;
  job.lockedAt = undefined;
  job.lockedBy = undefined;
  job.updatedAt = now;
  job.error = job.error ?? "Job was manually requeued.";
  await writeJobsFile(file);
  return { ok: true as const, job: normalizeJobRecord(job) };
}

async function readWorkerHeartbeatsFile(): Promise<{ workers: WorkerHeartbeatRecord[] }> {
  try {
    const raw = await readFile(workerHeartbeatsFile, "utf8");
    const parsed = JSON.parse(raw) as { workers?: WorkerHeartbeatRecord[] };
    return { workers: Array.isArray(parsed.workers) ? parsed.workers : [] };
  } catch {
    return { workers: [] };
  }
}

async function writeWorkerHeartbeatsFile(file: { workers: WorkerHeartbeatRecord[] }) {
  await mkdir(dirname(workerHeartbeatsFile), { recursive: true });
  await writeFile(workerHeartbeatsFile, `${JSON.stringify(file, null, 2)}\n`);
}

function assertString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`Missing ${label}`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function retryDelayMs(attempts: number) {
  const exponent = Math.max(0, Math.min(attempts - 1, 5));
  return 1000 * 60 * 2 ** exponent;
}

export function maxAttemptsFromPayload(payload: Record<string, unknown>) {
  const value = typeof payload.maxAttempts === "number" ? payload.maxAttempts : defaultJobMaxAttempts;
  return Math.max(1, Math.min(Math.trunc(value), 10));
}

export function runAfterFromPayload(payload: Record<string, unknown>, fallback: string) {
  return typeof payload.runAfter === "string" && !Number.isNaN(new Date(payload.runAfter).getTime())
    ? payload.runAfter
    : fallback;
}

export function normalizeJobRecord(job: Partial<JobRecord> & Pick<JobRecord, "id" | "kind" | "status" | "payload" | "attempts" | "createdAt" | "updatedAt">): JobRecord {
  return {
    ...job,
    result: job.result,
    error: job.error,
    maxAttempts: job.maxAttempts ?? defaultJobMaxAttempts,
    runAfter: job.runAfter ?? job.createdAt,
    lockedBy: job.lockedBy,
    lockedAt: job.lockedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt
  };
}

function parseBatchUrls(input: unknown) {
  const rawUrls = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[\n,]/)
      : [];
  return Array.from(
    new Set(
      rawUrls
        .map((url) => (typeof url === "string" ? url.trim() : ""))
        .filter((url) => /^https?:\/\//i.test(url))
    )
  );
}

function summarizeInquiries(inquiries: Inquiry[]) {
  const byStatus: Record<Inquiry["status"], number> = {
    new: 0,
    needs_reply: 0,
    replied: 0,
    booked: 0,
    won: 0,
    lost: 0,
    spam: 0,
    archived: 0
  };
  const channels = new Map<string, number>();
  for (const inquiry of inquiries) {
    byStatus[inquiry.status] += 1;
    channels.set(inquiry.sourceChannel, (channels.get(inquiry.sourceChannel) ?? 0) + 1);
  }

  return {
    total: inquiries.length,
    ...byStatus,
    byChannel: Array.from(channels.entries())
      .map(([channel, total]) => ({ channel, total }))
      .sort((left, right) => right.total - left.total || left.channel.localeCompare(right.channel)),
    recent: [...inquiries]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 5)
      .map((inquiry) => ({
        id: inquiry.id,
        sourceChannel: inquiry.sourceChannel,
        status: inquiry.status,
        createdAt: inquiry.createdAt,
        contactEmail: inquiry.contactEmailNormalized
      }))
  };
}

function qaSummary(qa: ReturnType<typeof runSiteQa>) {
  return {
    passed: qa.passed,
    checks: qa.checks.length,
    failures: qa.checks.filter((check) => check.severity === "fail").length,
    warnings: qa.checks.filter((check) => check.severity === "warning").length
  };
}
