import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AnalyticsSummary,
  ExperimentAnalysis,
  ExperimentLearning,
  JobKind,
  JobRecord,
  LeadSubmission,
  OptimizationFinding,
  SiteBundle
} from "./models";
import { crawlUrl } from "./crawler";
import { createSiteFromInput } from "./intake";
import { runAudit } from "./audit";
import { createPresenceIntakePlan } from "./presence-intake";
import { gatherPublicPresenceSignals } from "./public-presence";
import { runSiteQa } from "./qa";
import { inspectUrlRender } from "./render-inspection";
import { assertPublicFetchUrl } from "./url-safety";
import { prepareIntakeInput } from "./intake-pipeline";
import { assertLaunchMarket } from "./launch-market";

const jobsFile = join(process.cwd(), ".data", "jobs.json");
export const defaultJobMaxAttempts = 3;
export const defaultJobStaleAfterMs = 1000 * 60 * 15;

type JobsFile = {
  jobs: JobRecord[];
};

export type JobExecutionContext = {
  workerId?: string;
  createAndStoreSite?: (input: { url?: string; prompt?: string }) => Promise<SiteBundle>;
  createPreviewToken?: (input: { siteId: string; expiresAt?: string }) => Promise<{ token: string } | null>;
  getSiteBundle?: (siteId: string) => Promise<SiteBundle | null>;
  runAndStoreAudit?: (siteId: string) => Promise<OptimizationFinding[] | null>;
  analyticsSummary?: (siteId: string) => Promise<AnalyticsSummary>;
  pruneAnalyticsEvents?: (input: { before: string; siteId?: string }) => Promise<{ deleted: number; before: string; siteId?: string }>;
  analyzeExperiments?: (siteId: string) => Promise<ExperimentAnalysis[]>;
  listExperimentLearnings?: (siteId?: string) => Promise<ExperimentLearning[]>;
  listFormSubmissions?: (siteId?: string) => Promise<LeadSubmission[]>;
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

export async function processNextJob(context?: JobExecutionContext) {
  const file = await readJobsFile();
  if (requeueStaleLocalJobs(file, Date.now())) await writeJobsFile(file);
  const nowMs = Date.now();
  const job = file.jobs.find((candidate) => candidate.status === "queued" && new Date(candidate.runAfter).getTime() <= nowMs);
  if (!job) return null;

  job.status = "running";
  job.attempts += 1;
  job.startedAt = new Date().toISOString();
  job.lockedAt = job.startedAt;
  job.lockedBy = context?.workerId ?? "local-worker";
  job.updatedAt = job.startedAt;
  await writeJobsFile(file);

  try {
    const result = await executeJob(job, context);
    await updateJob(job.id, {
      status: "completed",
      result,
      completedAt: new Date().toISOString()
    });
    return await getJob(job.id);
  } catch (error) {
    await failOrRetryLocalJob(job.id, error);
    return await getJob(job.id);
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
  switch (job.kind) {
    case "presence_assessment": {
      const url = await assertPublicFetchUrl(assertString(job.payload.url, "url"));
      assertLaunchMarket({ url });
      const [crawl, renderInspection] = await Promise.all([
        crawlUrl(url),
        inspectUrlRender({
          url,
          captureScreenshots: job.payload.screenshots !== false
        })
      ]);
      const publicPresence = await gatherPublicPresenceSignals({ url, crawl });
      assertLaunchMarket({ url, crawl, publicPresence });
      return createPresenceIntakePlan(url, crawl, renderInspection, publicPresence) as unknown as Record<string, unknown>;
    }
    case "generate_site": {
      const input = {
        url: typeof job.payload.url === "string" ? job.payload.url : undefined,
        prompt: typeof job.payload.prompt === "string" ? job.payload.prompt : undefined
      };
      const bundle = context?.createAndStoreSite
        ? await context.createAndStoreSite(input)
        : createSiteFromInput(await prepareIntakeInput(input));
      return {
        siteId: bundle.businessProfile.siteId,
        slug: bundle.siteModel.slug,
        vertical: bundle.businessProfile.vertical,
        pages: bundle.siteModel.versions[0]?.pages.length ?? 0,
        findings: bundle.optimizationFindings.length
      };
    }
    case "import_batch": {
      if (!context?.createAndStoreSite) {
        throw new Error("import_batch requires repository-backed job context");
      }
      const urls = parseBatchUrls(job.payload.urls ?? job.payload.text);
      if (urls.length === 0) throw new Error("import_batch requires at least one URL");
      const prompt = typeof job.payload.prompt === "string" ? job.payload.prompt : undefined;
      const createPreviews = job.payload.createPreviews !== false;
      const results = [];

      for (const url of urls) {
        try {
          const bundle = await context.createAndStoreSite({ url, prompt });
          const preview = createPreviews && context.createPreviewToken
            ? await context.createPreviewToken({
                siteId: bundle.businessProfile.siteId,
                expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
              })
            : null;
          results.push({
            ok: true,
            url,
            siteId: bundle.businessProfile.siteId,
            slug: bundle.siteModel.slug,
            vertical: bundle.businessProfile.vertical,
            pages: bundle.siteModel.versions[0]?.pages.length ?? 0,
            previewToken: preview?.token
          });
        } catch (error) {
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
      const bundle = createSiteFromInput({
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
      const [findings, analytics, experiments, learnings, leads] = await Promise.all([
        context.runAndStoreAudit(siteId),
        context.analyticsSummary(siteId),
        context.analyzeExperiments(siteId),
        context.listExperimentLearnings?.(siteId) ?? Promise.resolve([]),
        context.listFormSubmissions?.(siteId) ?? Promise.resolve([])
      ]);
      const qa = runSiteQa(bundle, { versionStatus: "draft" });
      const openFindings = (findings ?? []).filter((finding) => finding.status === "open");
      const autoApplicable = openFindings.filter((finding) => finding.applyMode !== "manual_service");
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
        leads: leads.length,
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
    case "analytics_retention": {
      if (!context?.pruneAnalyticsEvents) {
        throw new Error("analytics_retention requires repository-backed job context");
      }
      const before = retentionCutoffFromPayload(job.payload);
      const siteId = typeof job.payload.siteId === "string" ? job.payload.siteId : undefined;
      const result = await context.pruneAnalyticsEvents({ before, siteId });
      return {
        prunedAt: new Date().toISOString(),
        retentionDays: retentionDaysFromPayload(job.payload),
        ...result
      };
    }
    default:
      job.kind satisfies never;
      throw new Error(`Unsupported job kind: ${job.kind}`);
  }
}

export function retentionDaysFromPayload(payload: Record<string, unknown>) {
  const raw = typeof payload.retentionDays === "number"
    ? payload.retentionDays
    : Number(process.env.LODESTA_ANALYTICS_RETENTION_DAYS ?? 395);
  return Math.max(30, Math.min(Math.trunc(Number.isFinite(raw) ? raw : 395), 3650));
}

export function retentionCutoffFromPayload(payload: Record<string, unknown>) {
  if (typeof payload.before === "string" && !Number.isNaN(new Date(payload.before).getTime())) {
    return new Date(payload.before).toISOString();
  }
  return new Date(Date.now() - retentionDaysFromPayload(payload) * 24 * 60 * 60 * 1000).toISOString();
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
  const now = new Date().toISOString();
  if (job.attempts < job.maxAttempts) {
    Object.assign(job, {
      status: "queued" as const,
      error: message,
      runAfter: new Date(Date.now() + retryDelayMs(job.attempts)).toISOString(),
      lockedAt: undefined,
      lockedBy: undefined,
      updatedAt: now
    });
  } else {
    Object.assign(job, {
      status: "failed" as const,
      error: message,
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

function assertString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`Missing ${label}`);
  return value;
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

function qaSummary(qa: ReturnType<typeof runSiteQa>) {
  return {
    passed: qa.passed,
    checks: qa.checks.length,
    failures: qa.checks.filter((check) => check.severity === "fail").length,
    warnings: qa.checks.filter((check) => check.severity === "warning").length
  };
}
