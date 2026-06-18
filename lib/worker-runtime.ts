export const defaultWorkerIdleMs = 5000;
export const minimumWorkerIdleMs = 250;

export type WorkerIdleMsResolution = {
  idleMs: number;
  source: "positional" | "env" | "default";
  warnings: string[];
};

export function resolveWorkerIdleMs(input: {
  positional?: string;
  env?: string;
  defaultMs?: number;
  minimumMs?: number;
} = {}): WorkerIdleMsResolution {
  const defaultMs = input.defaultMs ?? defaultWorkerIdleMs;
  const minimumMs = input.minimumMs ?? minimumWorkerIdleMs;
  const positional = parseWorkerIdleMs(input.positional, "positional CLI idle interval", minimumMs);
  const env = parseWorkerIdleMs(input.env, "LODESTA_WORKER_IDLE_MS", minimumMs);
  const warnings = [...positional.warnings, ...env.warnings];

  if (positional.value !== undefined) {
    return { idleMs: positional.value, source: "positional", warnings };
  }
  if (env.value !== undefined) {
    return { idleMs: env.value, source: "env", warnings };
  }

  return { idleMs: Math.max(minimumMs, defaultMs), source: "default", warnings };
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
