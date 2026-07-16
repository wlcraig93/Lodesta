export function elapsedOpenAiCallMs(startedAt: string, endedAt: string) {
  return Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
}

export function extractOpenAiResponseText(payload: unknown) {
  if (isRecord(payload) && typeof payload.output_text === "string") return payload.output_text;
  if (!isRecord(payload) || !Array.isArray(payload.output)) return undefined;
  const parts: string[] = [];
  for (const output of payload.output) {
    if (!isRecord(output) || !Array.isArray(output.content)) continue;
    for (const item of output.content) {
      if (!isRecord(item)) continue;
      if (item.type === "refusal" && typeof item.refusal === "string") {
        throw new Error(`OpenAI structured response refused: ${item.refusal}`);
      }
      if (typeof item.parsed === "object" && item.parsed) return JSON.stringify(item.parsed);
      if (typeof item.text === "string") parts.push(item.text);
    }
  }
  return parts.join("").trim() || undefined;
}

export function openAiErrorMessage(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
  return typeof payload.error.message === "string" ? payload.error.message : undefined;
}

/**
 * The /v1/responses API returns `status: "incomplete"` when generation stopped
 * before the model finished — almost always `max_output_tokens`. The output
 * text is then a truncated, often mid-token string (a clipped multi-byte token
 * can decode to a stray CJK glyph), which still passes length-only schema
 * validation. Callers must treat an incomplete response as a failure and retry
 * with a larger budget rather than shipping the fragment as copy.
 */
export function openAiResponseIncompleteReason(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (payload.status !== "incomplete") return undefined;
  const details = payload.incomplete_details;
  if (isRecord(details) && typeof details.reason === "string") return details.reason;
  return "incomplete";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
