import { parseBoundedEnvMs } from "./timeout-config";
import { hostname } from "node:os";
import type { JobRecord, RepositoryMode, WorkerHeartbeatRecord, WorkerQueueStatus } from "./models";

export const defaultWorkerIdleMs = 5000;
export const minimumWorkerIdleMs = 250;
export const maximumWorkerIdleMs = 60_000;
export const defaultWorkerHeartbeatMs = 2000;
export const devWorkerHeartbeatStaleMs = 10_000;
export const deployedWorkerHeartbeatStaleMs = 30_000;

let processStartedAt = new Date().toISOString();
let currentWorkerJob: { id: string; kind: JobRecord["kind"] } | undefined;

export type WorkerIdleMsResolution = {
  idleMs: number;
  source: "positional" | "env" | "default";
  warnings: string[];
};

export function repositoryModeFromEnv(env: NodeJS.ProcessEnv = process.env): RepositoryMode {
  return env.LODESTA_REPOSITORY === "local" ? "local" : "supabase";
}

export function workerHeartbeatStaleMs(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "development" || env.LODESTA_WORKER_STALE_MODE === "dev"
    ? devWorkerHeartbeatStaleMs
    : deployedWorkerHeartbeatStaleMs;
}

export function setWorkerCurrentJob(job: Pick<JobRecord, "id" | "kind"> | undefined) {
  currentWorkerJob = job ? { id: job.id, kind: job.kind } : undefined;
}

export function resetWorkerRuntimeForTests(startedAt = new Date().toISOString()) {
  processStartedAt = startedAt;
  currentWorkerJob = undefined;
}

export function buildProcessWorkerHeartbeat(input: {
  workerId: string;
  now?: string;
  repositoryMode?: RepositoryMode;
}): WorkerHeartbeatRecord {
  const now = input.now ?? new Date().toISOString();
  return {
    workerId: input.workerId,
    pid: process.pid,
    host: hostname(),
    repositoryMode: input.repositoryMode ?? repositoryModeFromEnv(),
    startedAt: processStartedAt,
    lastSeenAt: now,
    currentJobId: currentWorkerJob?.id,
    currentJobKind: currentWorkerJob?.kind
  };
}

export function buildWorkerQueueStatus(input: {
  jobs: JobRecord[];
  heartbeats: WorkerHeartbeatRecord[];
  now?: number;
  staleAfterMs?: number;
  repositoryMode?: RepositoryMode;
}): WorkerQueueStatus {
  const nowMs = input.now ?? Date.now();
  const staleAfterMs = input.staleAfterMs ?? workerHeartbeatStaleMs();
  const activeWorkers = input.heartbeats
    .filter((heartbeat) => heartbeatIsFresh(heartbeat, nowMs, staleAfterMs))
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  const staleWorkers = input.heartbeats
    .filter((heartbeat) => !heartbeatIsFresh(heartbeat, nowMs, staleAfterMs))
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  const queueDepthByKindStatus: WorkerQueueStatus["queueDepthByKindStatus"] = {};
  for (const job of input.jobs) {
    const byStatus = queueDepthByKindStatus[job.kind] ?? {};
    byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
    queueDepthByKindStatus[job.kind] = byStatus;
  }
  const queuedAges = input.jobs
    .filter((job) => job.status === "queued")
    .map((job) => nowMs - Date.parse(job.runAfter || job.createdAt))
    .filter((age) => Number.isFinite(age) && age >= 0);
  return {
    now: new Date(nowMs).toISOString(),
    repositoryMode: input.repositoryMode ?? repositoryModeFromEnv(),
    staleAfterSeconds: Math.round(staleAfterMs / 1000),
    activeWorkerCount: activeWorkers.length,
    activeWorkers,
    staleWorkers,
    queueDepthByKindStatus,
    oldestQueuedAgeSeconds: queuedAges.length ? Math.round(Math.max(...queuedAges) / 1000) : undefined,
    runningJobs: input.jobs
      .filter((job) => job.status === "running")
      .map((job) => ({
        id: job.id,
        kind: job.kind,
        lockedBy: job.lockedBy,
        lockedAt: job.lockedAt,
        elapsedSeconds: job.startedAt ? Math.max(0, Math.round((nowMs - Date.parse(job.startedAt)) / 1000)) : undefined
      }))
  };
}

export function heartbeatIsFresh(heartbeat: WorkerHeartbeatRecord, nowMs = Date.now(), staleAfterMs = workerHeartbeatStaleMs()) {
  const lastSeen = Date.parse(heartbeat.lastSeenAt);
  return Number.isFinite(lastSeen) && nowMs - lastSeen <= staleAfterMs;
}

export function resolveWorkerIdleMs(input: {
  positional?: string;
  env?: string;
  defaultMs?: number;
  minimumMs?: number;
} = {}): WorkerIdleMsResolution {
  const defaultMs = input.defaultMs ?? defaultWorkerIdleMs;
  const minimumMs = input.minimumMs ?? minimumWorkerIdleMs;
  const positional = parseWorkerIdleMs(input.positional, "positional CLI idle interval", minimumMs);
  const env = parseBoundedWorkerIdleEnv(input.env, defaultMs, minimumMs);
  const warnings = [...positional.warnings, ...env.warnings];

  if (positional.value !== undefined) {
    return { idleMs: positional.value, source: "positional", warnings };
  }
  if (env.value !== undefined) {
    return { idleMs: env.value, source: "env", warnings };
  }

  return { idleMs: Math.max(minimumMs, defaultMs), source: "default", warnings };
}

function parseBoundedWorkerIdleEnv(rawValue: string | undefined, defaultMs: number, minimumMs: number) {
  if (rawValue === undefined || rawValue.trim() === "") return { warnings: [] };
  const resolved = parseBoundedEnvMs(
    "LODESTA_WORKER_IDLE_MS",
    { defaultMs, minMs: minimumMs, maxMs: maximumWorkerIdleMs },
    { LODESTA_WORKER_IDLE_MS: rawValue }
  );
  return resolved.source === "env" ? { value: resolved.value, warnings: resolved.warnings } : { warnings: resolved.warnings };
}

function parseWorkerIdleMs(rawValue: string | undefined, label: string, minimumMs: number) {
  const warnings: string[] = [];
  if (rawValue === undefined || rawValue.trim() === "") return { warnings };

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    warnings.push(`${label} "${rawValue}" is invalid; ignoring it.`);
    return { warnings };
  }

  const idleMs = Math.trunc(parsed);
  if (idleMs < minimumMs) {
    warnings.push(`${label} ${idleMs}ms is below the ${minimumMs}ms minimum; using ${minimumMs}ms.`);
    return { value: minimumMs, warnings };
  }

  return { value: idleMs, warnings };
}
