import { parseBoundedEnvMs } from "./timeout-config";

export const defaultOpenAiRequestTimeoutMs = 300_000;
export const minOpenAiRequestTimeoutMs = 5_000;
export const maxOpenAiRequestTimeoutMs = 600_000;

export function openAiRequestSignal(defaultTimeoutMs = defaultOpenAiRequestTimeoutMs, externalSignal?: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(openAiRequestTimeoutMs(defaultTimeoutMs));
  return externalSignal ? AbortSignal.any([timeoutSignal, externalSignal]) : timeoutSignal;
}

export function openAiRequestTimeoutMs(defaultTimeoutMs = defaultOpenAiRequestTimeoutMs) {
  return parseBoundedEnvMs("OPENAI_REQUEST_TIMEOUT_MS", {
    defaultMs: defaultTimeoutMs,
    minMs: minOpenAiRequestTimeoutMs,
    maxMs: maxOpenAiRequestTimeoutMs
  }).value;
}
