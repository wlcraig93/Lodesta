export type BoundedMsConfig = {
  defaultMs: number;
  minMs: number;
  maxMs: number;
};

export type BoundedMsResolution = {
  value: number;
  source: "env" | "default";
  warnings: string[];
};

export function parseBoundedEnvMs(
  envName: string,
  config: BoundedMsConfig,
  env: Record<string, string | undefined> = process.env
): BoundedMsResolution {
  const raw = env[envName];
  if (raw === undefined || raw.trim() === "") {
    return { value: config.defaultMs, source: "default", warnings: [] };
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return {
      value: config.defaultMs,
      source: "default",
      warnings: [`${envName} "${raw}" is invalid; using ${config.defaultMs}ms.`]
    };
  }

  const value = Math.trunc(parsed);
  if (value < config.minMs || value > config.maxMs) {
    return {
      value: config.defaultMs,
      source: "default",
      warnings: [`${envName} ${value}ms is outside ${config.minMs}..${config.maxMs}; using ${config.defaultMs}ms.`]
    };
  }

  return { value, source: "env", warnings: [] };
}
