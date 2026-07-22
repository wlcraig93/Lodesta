import { randomBytes } from "node:crypto";
import { sha256, stableJson } from "@/packages/business-data";
import type { ArtifactBlobStore } from "@/packages/site-artifacts";
import { siteAgentTraceSpanV1Schema, type SiteAgentTraceSpanV1 } from "@/packages/site-contracts";
import type { SitePlatformRepository } from "@/packages/platform-data";
import type { ManagerTraceEventV1 } from "@/packages/site-agent";

const payloadRetentionMs = 30 * 24 * 60 * 60_000;
const maxPayloadBytes = 256 * 1024;
const secretKey = /authorization|cookie|password|secret|token|api[-_]?key/i;

export class SiteAgentTraceRecorderV1 {
  constructor(
    private readonly repository: SitePlatformRepository,
    private readonly blobStore: ArtifactBlobStore,
    readonly traceId: string,
    private readonly linkage: { runId?: string; sessionId?: string; requestId?: string; attemptIndex?: number }
  ) {}

  async recordManagerEvents(events: ManagerTraceEventV1[]) {
    const spans: SiteAgentTraceSpanV1[] = [];
    for (const event of events) {
      const payload = event.payload ? await this.persistPayload(event.id, event.payload) : {};
      spans.push(siteAgentTraceSpanV1Schema.parse({
        schemaVersion: "site-agent-trace-span-v1",
        id: event.id,
        traceId: this.traceId,
        ...this.linkage,
        parentSpanId: event.parentSpanId,
        sequence: 0,
        kind: event.kind,
        name: event.name,
        status: event.status,
        turnIndex: event.turnIndex,
        modelId: event.modelId,
        inputTokens: event.inputTokens,
        cachedInputTokens: event.cachedInputTokens,
        outputTokens: event.outputTokens,
        summary: boundedSummary(event.summary),
        ...payload,
        errorCode: event.errorCode,
        startedAt: event.startedAt,
        completedAt: event.completedAt
      }));
    }
    return this.repository.saveTraceSpans(spans);
  }

  async open(input: {
    id?: string;
    parentSpanId?: string;
    kind: SiteAgentTraceSpanV1["kind"];
    name: string;
    summary?: Record<string, unknown>;
    modelId?: string;
  }) {
    const span = siteAgentTraceSpanV1Schema.parse({
      schemaVersion: "site-agent-trace-span-v1",
      id: input.id ?? traceSpanId(),
      traceId: this.traceId,
      ...this.linkage,
      parentSpanId: input.parentSpanId,
      sequence: 0,
      kind: input.kind,
      name: input.name,
      status: "running",
      modelId: input.modelId,
      summary: boundedSummary(input.summary ?? {}),
      startedAt: new Date().toISOString()
    });
    return (await this.repository.saveTraceSpans([span]))[0] ?? span;
  }

  async close(span: SiteAgentTraceSpanV1, input: {
    status: "succeeded" | "failed" | "cancelled";
    summary?: Record<string, unknown>;
    payload?: Record<string, unknown>;
    errorCode?: string;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    modelId?: string;
  }) {
    const payload = input.payload ? await this.persistPayload(span.id, input.payload) : {};
    const completed = siteAgentTraceSpanV1Schema.parse({
      ...span,
      status: input.status,
      summary: boundedSummary(input.summary ?? span.summary),
      ...payload,
      errorCode: input.errorCode,
      inputTokens: input.inputTokens,
      cachedInputTokens: input.cachedInputTokens,
      outputTokens: input.outputTokens,
      modelId: input.modelId ?? span.modelId,
      completedAt: new Date().toISOString()
    });
    return (await this.repository.saveTraceSpans([completed]))[0] ?? completed;
  }

  private async persistPayload(spanId: string, value: Record<string, unknown>) {
    const sanitized = sanitize(value);
    let bytes = Buffer.from(stableJson(sanitized));
    if (bytes.length > maxPayloadBytes) {
      bytes = Buffer.from(stableJson({ truncated: true, bytes: bytes.length, preview: bytes.toString("utf8", 0, maxPayloadBytes - 256) }));
    }
    const payloadHash = sha256(bytes);
    const payloadRef = `trace-payloads/${this.traceId}/${spanId}/${payloadHash.slice("sha256:".length)}.json`;
    await this.blobStore.putImmutable({ key: payloadRef, bytes, contentType: "application/json", contentHash: payloadHash });
    return {
      payloadRef,
      payloadHash,
      payloadExpiresAt: new Date(Date.now() + payloadRetentionMs).toISOString()
    };
  }
}

export function traceSpanId() {
  const time = Date.now().toString(36).padStart(9, "0");
  return `span_${time}${randomBytes(10).toString("hex")}`;
}

function boundedSummary(value: Record<string, unknown>) {
  const sanitized = sanitize(value);
  const encoded = stableJson(sanitized);
  return encoded.length <= 16_000 ? sanitized as Record<string, unknown> : { truncated: true, preview: encoded.slice(0, 15_800) };
}

function sanitize(value: unknown, key = ""): unknown {
  if (secretKey.test(key)) return "[redacted]";
  if (typeof value === "string") {
    if (/^data:[^;]+;base64,/i.test(value)) return "[binary omitted]";
    return value.length > 120_000 ? `${value.slice(0, 119_900)}...[truncated]` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 200).map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)]));
  }
  return value;
}
