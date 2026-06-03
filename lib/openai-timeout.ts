export function openAiRequestSignal(defaultTimeoutMs = 45_000) {
  return AbortSignal.timeout(openAiRequestTimeoutMs(defaultTimeoutMs));
}

export function openAiRequestTimeoutMs(defaultTimeoutMs = 45_000) {
  const configured = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 5_000 && configured <= 180_000) return configured;
  return defaultTimeoutMs;
}
