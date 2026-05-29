import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AnalyticsSummary, ExperimentAnalysis, JobKind, JobRecord, LeadSubmission, OptimizationFinding, SiteBundle } from "./models";
import { crawlUrl } from "./crawler";
import { createSiteFromInput } from "./intake";
import { runAudit } from "./audit";
import { createPresenceIntakePlan } from "./presence-intake";
import { runSiteQa } from "./qa";

const jobsFile = join(process.cwd(), ".data", "jobs.json");

type JobsFile = {
  jobs: JobRecord[];
};

export type JobExecutionContext = {
  createAndStoreSite?: (input: { url?: string; prompt?: string }) => Promise<SiteBundle>;
  createPreviewToken?: (input: { siteId: string; expiresAt?: string }) => Promise<{ token: string } | null>;
  getSiteBundle?: (siteId: string) => Promise<SiteBundle | null>;
  runAndStoreAudit?: (siteId: string) => Promise<OptimizationFinding[] | null>;
  analyticsSummary?: (siteId: string) => Promise<AnalyticsSummary>;
  analyzeExperiments?: (siteId: string) => Promise<ExperimentAnalysis[]>;
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
  const job = file.jobs.find((candidate) => candidate.status === "queued");
  if (!job) return null;

  job.status = "running";
  job.attempts += 1;
  job.startedAt = new Date().toISOString();
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
    await updateJob(job.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown job error",
      completedAt: new Date().toISOString()
    });
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
      const url = assertString(job.payload.url, "url");
      const crawl = await crawlUrl(url);
      return createPresenceIntakePlan(url, crawl) as unknown as Record<string, unknown>;
    }
    case "generate_site": {
      const input = {
        url: typeof job.payload.url === "string" ? job.payload.url : undefined,
        prompt: typeof job.payload.prompt === "string" ? job.payload.prompt : undefined
      };
      const bundle = context?.createAndStoreSite
        ? await context.createAndStoreSite(input)
        : createSiteFromInput({
          ...input,
          crawl: input.url ? await crawlUrl(input.url) : undefined
        });
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
      const [findings, analytics, experiments, leads] = await Promise.all([
        context.runAndStoreAudit(siteId),
        context.analyticsSummary(siteId),
        context.analyzeExperiments(siteId),
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
        }))
      };
    }
    default:
      job.kind satisfies never;
      throw new Error(`Unsupported job kind: ${job.kind}`);
  }
}

async function updateJob(id: string, patch: Partial<JobRecord>) {
  const file = await readJobsFile();
  const job = file.jobs.find((candidate) => candidate.id === id);
  if (!job) throw new Error(`Job not found: ${id}`);
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  await writeJobsFile(file);
}

async function readJobsFile(): Promise<JobsFile> {
  try {
    const raw = await readFile(jobsFile, "utf8");
    const parsed = JSON.parse(raw) as JobsFile;
    return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
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
