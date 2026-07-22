import { randomBytes } from "node:crypto";
import { sha256, stableJson } from "@/packages/business-data";
import type { ArtifactBlobStore } from "@/packages/site-artifacts";
import { siteAgentRunEventSchema, type SiteAgentRunEvent } from "@/packages/site-contracts";
import type { SitePlatformRepository } from "@/packages/platform-data";
import type { ManagerRunEvent } from "@/packages/site-agent";

export const runEventPayloadRetentionMs = 24 * 60 * 60_000;
const maxPayloadBytes = 256 * 1024;
const secretKey = /authorization|cookie|password|secret|token|api[-_]?key/i;

export class SiteAgentEventRecorder {
  constructor(
    private readonly repository: SitePlatformRepository,
    private readonly blobStore: ArtifactBlobStore,
    readonly runId: string
  ) {}

  async recordManagerEvents(events: ManagerRunEvent[]) {
    const runEvents: SiteAgentRunEvent[] = [];
    for (const event of events) {
      const payload = event.payload ? await this.persistPayload(event.id, event.payload) : {};
      runEvents.push(siteAgentRunEventSchema.parse({
        schemaVersion: "site-agent-run-event",
        id: event.id,
        runId: this.runId,
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
    return this.repository.saveAgentRunEvents(runEvents);
  }

  async open(input: {
    id?: string;
    kind: SiteAgentRunEvent["kind"];
    name: string;
    summary?: Record<string, unknown>;
    modelId?: string;
  }) {
    const runEvent = siteAgentRunEventSchema.parse({
      schemaVersion: "site-agent-run-event",
      id: input.id ?? runEventId(),
      runId: this.runId,
      sequence: 0,
      kind: input.kind,
      name: input.name,
      status: "running",
      modelId: input.modelId,
      summary: boundedSummary(input.summary ?? {}),
      startedAt: new Date().toISOString()
    });
    return (await this.repository.saveAgentRunEvents([runEvent]))[0] ?? runEvent;
  }

  async close(runEvent: SiteAgentRunEvent, input: {
    status: "succeeded" | "failed" | "cancelled";
    summary?: Record<string, unknown>;
    payload?: Record<string, unknown>;
    errorCode?: string;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    modelId?: string;
  }) {
    const payload = input.payload ? await this.persistPayload(runEvent.id, input.payload) : {};
    const completed = siteAgentRunEventSchema.parse({
      ...runEvent,
      status: input.status,
      summary: boundedSummary(input.summary ?? runEvent.summary),
      ...payload,
      errorCode: input.errorCode,
      inputTokens: input.inputTokens,
      cachedInputTokens: input.cachedInputTokens,
      outputTokens: input.outputTokens,
      modelId: input.modelId ?? runEvent.modelId,
      completedAt: new Date().toISOString()
    });
    return (await this.repository.saveAgentRunEvents([completed]))[0] ?? completed;
  }

  private async persistPayload(eventId: string, value: Record<string, unknown>) {
    const sanitized = sanitize(value);
    let bytes = Buffer.from(stableJson(sanitized));
    if (bytes.length > maxPayloadBytes) {
      bytes = Buffer.from(stableJson({ truncated: true, bytes: bytes.length, preview: bytes.toString("utf8", 0, maxPayloadBytes - 256) }));
    }
    const payloadHash = sha256(bytes);
    const payloadRef = `agent-run-events/${this.runId}/${eventId}/${payloadHash.slice("sha256:".length)}.json`;
    await this.blobStore.putImmutable({ key: payloadRef, bytes, contentType: "application/json", contentHash: payloadHash });
    return {
      payloadRef,
      payloadHash,
      payloadExpiresAt: new Date(Date.now() + runEventPayloadRetentionMs).toISOString()
    };
  }
}

export function runEventId() {
  const time = Date.now().toString(36).padStart(9, "0");
  return `event_${time}${randomBytes(10).toString("hex")}`;
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
