import type { JobKind, JobRecord, SiteBundle } from "./models";

export type ScheduleTask = "monthly_action_lists" | "launch_maintenance";

export type ScheduleLaunchJobsInput = {
  task?: ScheduleTask;
  siteIds?: string[];
  scheduleKey?: string;
  runAfter?: string;
};

export type ScheduledJobSpec = {
  kind: JobKind;
  payload: Record<string, unknown>;
};

export type ScheduleLaunchJobsResult = {
  ok: true;
  task: ScheduleTask;
  scheduleKey: string;
  scheduledAt: string;
  queued: JobRecord[];
  skipped: Array<{
    kind: JobKind;
    siteId?: string;
    reason: "duplicate" | "unknown_site";
  }>;
};

type SchedulerRepository = {
  listSiteBundles(): Promise<SiteBundle[]>;
  listJobs(status?: JobRecord["status"]): Promise<JobRecord[]>;
  enqueueJob(kind: JobKind, payload: Record<string, unknown>): Promise<JobRecord>;
};

export async function scheduleLaunchJobs(
  repository: SchedulerRepository,
  input: ScheduleLaunchJobsInput = {},
  now = new Date()
): Promise<ScheduleLaunchJobsResult> {
  const task = input.task ?? "launch_maintenance";
  const scheduledAt = now.toISOString();
  const scheduleKey = input.scheduleKey?.trim() || defaultScheduleKey(task, now);
  const { specs, unknownSiteIds } = await buildJobSpecs(repository, input, task, scheduleKey, scheduledAt);
  const existing = await repository.listJobs();
  const queued: JobRecord[] = [];
  const skipped: ScheduleLaunchJobsResult["skipped"] = unknownSiteIds.map((siteId) => ({
    kind: "monthly_action_list",
    siteId,
    reason: "unknown_site" as const
  }));

  for (const spec of specs) {
    if (existing.some((job) => isDuplicateScheduledJob(job, spec))) {
      skipped.push({ kind: spec.kind, siteId: stringPayload(spec.payload.siteId), reason: "duplicate" });
      continue;
    }
    queued.push(await repository.enqueueJob(spec.kind, spec.payload));
  }

  return {
    ok: true,
    task,
    scheduleKey,
    scheduledAt,
    queued,
    skipped
  };
}

async function buildJobSpecs(
  repository: SchedulerRepository,
  input: ScheduleLaunchJobsInput,
  task: ScheduleTask,
  scheduleKey: string,
  scheduledAt: string
): Promise<{ specs: ScheduledJobSpec[]; unknownSiteIds: string[] }> {
  const specs: ScheduledJobSpec[] = [];
  const unknownSiteIds: string[] = [];
  const sites = await repository.listSiteBundles();
  const siteIds = input.siteIds?.length ? input.siteIds : sites.map((bundle) => bundle.businessProfile.siteId);
  const knownSiteIds = new Set(sites.map((bundle) => bundle.businessProfile.siteId));
  if (input.siteIds?.length) {
    unknownSiteIds.push(...input.siteIds.filter((siteId) => !knownSiteIds.has(siteId)));
  }

  if (task === "monthly_action_lists" || task === "launch_maintenance") {
    for (const siteId of siteIds) {
      if (!knownSiteIds.has(siteId)) {
        continue;
      }
      specs.push({
        kind: "monthly_action_list",
        payload: basePayload({ siteId, scheduleKey, scheduledAt, runAfter: input.runAfter })
      });
    }
  }
  if (task === "launch_maintenance") {
    specs.push({
      kind: "agent_telemetry_cleanup",
      payload: {
        ...basePayload({ scheduleKey, scheduledAt, runAfter: input.runAfter }),
        olderThanDays: 30,
        limit: 1000
      }
    });
  }

  return { specs, unknownSiteIds };
}

function basePayload(input: {
  siteId?: string;
  scheduleKey: string;
  scheduledAt: string;
  runAfter?: string;
}) {
  return {
    ...(input.siteId ? { siteId: input.siteId } : {}),
    ...(input.runAfter ? { runAfter: input.runAfter } : {}),
    scheduleKey: input.scheduleKey,
    scheduledAt: input.scheduledAt,
    scheduledBy: "cron"
  };
}

function isDuplicateScheduledJob(job: JobRecord, spec: ScheduledJobSpec) {
  if (job.status === "failed") return false;
  return (
    job.kind === spec.kind &&
    job.payload.scheduleKey === spec.payload.scheduleKey &&
    stringPayload(job.payload.siteId) === stringPayload(spec.payload.siteId)
  );
}

function defaultScheduleKey(task: ScheduleTask, now: Date) {
  const date = now.toISOString();
  if (task === "monthly_action_lists") return `monthly-action-list:${date.slice(0, 7)}`;
  return `launch-maintenance:${date.slice(0, 10)}`;
}

function stringPayload(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
