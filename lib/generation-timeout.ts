import { parseBoundedEnvMs } from "./timeout-config";

export const defaultGenerateSiteTimeoutMs = 1_200_000;
export const minGenerateSiteTimeoutMs = 120_000;
export const maxGenerateSiteTimeoutMs = 1_800_000;

export function generateSiteTimeoutMs() {
  return parseBoundedEnvMs("LODESTA_GENERATE_SITE_TIMEOUT_MS", {
    defaultMs: defaultGenerateSiteTimeoutMs,
    minMs: minGenerateSiteTimeoutMs,
    maxMs: maxGenerateSiteTimeoutMs
  }).value;
}

export class GenerateSiteTimeoutError extends Error {
  constructor(timeoutMs: number, context: string) {
    super(`Generation deadline exceeded after ${timeoutMs}ms (${context}).`);
    this.name = "GenerateSiteTimeoutError";
  }
}

export function generationTimeoutSignal(timeoutMs: number, context: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new GenerateSiteTimeoutError(timeoutMs, context));
  }, timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}
