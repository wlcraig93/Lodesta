import type {
  AgentModelCallRecord,
  AgentRunRecord,
  AgentRunSource,
  AgentRunStatus,
  AgentRunSpanRecord
} from "./models";
import type {
  CreateAgentRunInput,
  CreateAgentRunSpanInput,
  LodestaRepository,
  RecordAgentModelCallInput,
  UpdateAgentRunInput,
  UpdateAgentRunSpanInput
} from "./repository";

// Spans have up to four JSON columns, so a 64 KB field cap keeps each telemetry row under the 256 KB V1 budget.
const jsonFieldLimitBytes = 64 * 1024;
const maxStringBytes = 8 * 1024;
const maxCrawlTextBytes = 32 * 1024;
const redacted = "[redacted]";

type SpanFinishInput = {
  status?: AgentRunStatus;
  outputJson?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  artifactRefs?: Record<string, unknown>;
  errorMessage?: string;
};

export type AgentTelemetrySpan = {
  id?: string;
  end(input?: SpanFinishInput): Promise<void>;
  fail(error: unknown, input?: Omit<SpanFinishInput, "status" | "errorMessage">): Promise<void>;
};

export type AgentTelemetryRecorder = {
  runId?: string;
  source: AgentRunSource;
  startSpan(input: Omit<CreateAgentRunSpanInput, "runId">): Promise<AgentTelemetrySpan>;
  withSpan<T>(
    input: Omit<CreateAgentRunSpanInput, "runId" | "status" | "startedAt" | "endedAt" | "durationMs">,
    operation: (span: AgentTelemetrySpan) => Promise<T>
  ): Promise<T>;
  recordModelCall(input: Omit<RecordAgentModelCallInput, "runId">): Promise<void>;
  updateRun(input: Omit<UpdateAgentRunInput, "runId">): Promise<void>;
  completeRun(input?: Omit<UpdateAgentRunInput, "runId" | "status" | "endedAt">): Promise<void>;
  failRun(error: unknown, input?: Omit<UpdateAgentRunInput, "runId" | "status" | "endedAt" | "errorMessage">): Promise<void>;
};

export type SiteGenerationTelemetryInput = {
  source: AgentRunSource;
  url?: string;
  prompt?: string;
  actorType?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
};

export async function startSiteGenerationTelemetry(
  repository: LodestaRepository,
  input: SiteGenerationTelemetryInput
): Promise<AgentTelemetryRecorder> {
  const sourceUrl = input.url;
  const run = await bestEffort<AgentRunRecord | null>(
    () =>
      repository.createAgentRun({
        runType: "site_generation",
        agentType: "site_generator",
        status: "running",
        source: input.source,
        sourceUrl,
        sourceHost: sourceUrl ? hostnameFromUrl(sourceUrl) : undefined,
        actorType: input.actorType,
        actorId: input.actorId,
        inputSummary: input.url ?? input.prompt?.slice(0, 240) ?? "Prompt-only site generation",
        inputJson: sanitizeTelemetryPayload({
          url: input.url,
          prompt: input.prompt
        }),
        metadata: sanitizeTelemetryPayload({
          ...input.metadata,
          publicCustomerWebsiteMaterialAllowed: true
        })
      }),
    "Create agent telemetry run"
  );
  return run?.id ? new RepositoryAgentTelemetry(repository, run.id, input.source) : createNoopTelemetry(input.source);
}

export function createNoopTelemetry(source: AgentRunSource = "api"): AgentTelemetryRecorder {
  const span: AgentTelemetrySpan = {
    async end() {},
    async fail() {}
  };
  return {
    source,
    async startSpan() {
      return span;
    },
    async withSpan(_input, operation) {
      return operation(span);
    },
    async recordModelCall() {},
    async updateRun() {},
    async completeRun() {},
    async failRun() {}
  };
}

export function sanitizeTelemetryPayload(value: unknown): Record<string, unknown> {
  return capJsonObject(sanitizeValue(value, { path: [] }));
}

export function sanitizeTelemetryString(value: string, key?: string) {
  return sanitizeString(value, key ? [key] : []);
}

export function extractOpenAiUsage(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.usage)) return {};
  const usage = payload.usage;
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const inputTokens = numberValue(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = numberValue(usage.output_tokens ?? usage.completion_tokens);
  const cacheCreationTokens = numberValue(usage.cache_creation_input_tokens);
  const cacheReadTokens = numberValue(usage.cached_tokens ?? usage.cache_read_input_tokens ?? inputDetails.cached_tokens);
  return {
    usageJson: sanitizeTelemetryPayload(usage),
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens
  };
}

class RepositoryAgentTelemetry implements AgentTelemetryRecorder {
  constructor(
    private readonly repository: LodestaRepository,
    readonly runId: string,
    readonly source: AgentRunSource
  ) {}

  async startSpan(input: Omit<CreateAgentRunSpanInput, "runId">): Promise<AgentTelemetrySpan> {
    const startedAt = input.startedAt ?? new Date().toISOString();
    const span = await bestEffort<AgentRunSpanRecord | null>(
      () =>
        this.repository.createAgentRunSpan({
          ...input,
          runId: this.runId,
          status: input.status ?? "running",
          startedAt,
          inputJson: input.inputJson ? sanitizeTelemetryPayload(input.inputJson) : undefined,
          outputJson: input.outputJson ? sanitizeTelemetryPayload(input.outputJson) : undefined,
          metadata: input.metadata ? sanitizeTelemetryPayload(input.metadata) : undefined,
          artifactRefs: input.artifactRefs ? sanitizeTelemetryPayload(input.artifactRefs) : undefined
        }),
      `Create telemetry span ${input.name}`
    );
    return new RepositoryAgentTelemetrySpan(this.repository, span?.id, startedAt);
  }

  async withSpan<T>(
    input: Omit<CreateAgentRunSpanInput, "runId" | "status" | "startedAt" | "endedAt" | "durationMs">,
    operation: (span: AgentTelemetrySpan) => Promise<T>
  ): Promise<T> {
    const span = await this.startSpan(input);
    try {
      const result = await operation(span);
      await span.end();
      return result;
    } catch (error) {
      await span.fail(error);
      throw error;
    }
  }

  async recordModelCall(input: Omit<RecordAgentModelCallInput, "runId">): Promise<void> {
    await bestEffort(
      () =>
        this.repository.recordAgentModelCall({
          ...input,
          runId: this.runId,
          requestJson: input.requestJson ? sanitizeTelemetryPayload(input.requestJson) : undefined,
          responseJson: input.responseJson ? sanitizeTelemetryPayload(input.responseJson) : undefined,
          usageJson: input.usageJson ? sanitizeTelemetryPayload(input.usageJson) : undefined
        }),
      `Record model call ${input.operation}`
    );
  }

  async updateRun(input: Omit<UpdateAgentRunInput, "runId">): Promise<void> {
    await bestEffort(
      () =>
        this.repository.updateAgentRun({
          ...input,
          runId: this.runId,
          outputJson: input.outputJson ? sanitizeTelemetryPayload(input.outputJson) : input.outputJson,
          metadata: input.metadata ? sanitizeTelemetryPayload(input.metadata) : undefined
        }),
      "Update telemetry run"
    );
  }

  async completeRun(input: Omit<UpdateAgentRunInput, "runId" | "status" | "endedAt"> = {}): Promise<void> {
    await this.updateRun({
      ...input,
      status: "completed",
      endedAt: new Date().toISOString()
    });
  }

  async failRun(
    error: unknown,
    input: Omit<UpdateAgentRunInput, "runId" | "status" | "endedAt" | "errorMessage"> = {}
  ): Promise<void> {
    await this.updateRun({
      ...input,
      status: "failed",
      errorMessage: errorMessage(error),
      endedAt: new Date().toISOString()
    });
  }
}

class RepositoryAgentTelemetrySpan implements AgentTelemetrySpan {
  constructor(
    private readonly repository: LodestaRepository,
    readonly id: string | undefined,
    private readonly startedAt: string
  ) {}

  async end(input: SpanFinishInput = {}): Promise<void> {
    if (!this.id) return;
    const endedAt = new Date().toISOString();
    await bestEffort(
      () =>
        this.repository.updateAgentRunSpan({
          spanId: this.id!,
          status: input.status ?? "completed",
          outputJson: input.outputJson ? sanitizeTelemetryPayload(input.outputJson) : undefined,
          metadata: input.metadata ? sanitizeTelemetryPayload(input.metadata) : undefined,
          artifactRefs: input.artifactRefs ? sanitizeTelemetryPayload(input.artifactRefs) : undefined,
          errorMessage: input.errorMessage,
          endedAt,
          durationMs: elapsedMs(this.startedAt, endedAt)
        }),
      "Finish telemetry span"
    );
  }

  async fail(error: unknown, input: Omit<SpanFinishInput, "status" | "errorMessage"> = {}): Promise<void> {
    await this.end({
      ...input,
      status: "failed",
      errorMessage: errorMessage(error)
    });
  }
}

async function bestEffort<T>(operation: () => Promise<T>, label: string): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    console.error(`[agent-telemetry] ${label}: ${errorMessage(error)}`);
    return undefined;
  }
}

function sanitizeValue(value: unknown, context: { path: string[] }): unknown {
  const key = context.path.at(-1);
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return sanitizeString(value, context.path);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeValue(item, { path: context.path }));
  }
  if (!isRecord(value)) return String(value);

  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (isSensitiveKey(entryKey)) {
      output[entryKey] = redacted;
      continue;
    }
    if (isBinaryOrHtmlKey(entryKey, entryValue)) {
      output[entryKey] =
        typeof entryValue === "string" && isLikelyRawHtml(entryValue) ? "[omitted:raw_html]" : "[omitted]";
      continue;
    }
    output[entryKey] = sanitizeValue(entryValue, { path: [...context.path, entryKey] });
  }
  if (key && isCrawlTextKey(key)) {
    return capJsonObject(output, maxCrawlTextBytes);
  }
  return output;
}

function sanitizeString(value: string, path: string[]) {
  const key = path.at(-1) ?? "";
  if (isLikelyRawHtml(value) && /html|markup|document|page/i.test(key)) return "[omitted:raw_html]";
  if (isBase64Image(value)) return "[omitted:image_bytes]";

  const urlSanitized = sanitizeUrlString(value);
  const credentialSanitized = redactCredentialPatterns(urlSanitized);
  return truncateUtf8(credentialSanitized, maxStringBytes);
}

function sanitizeUrlString(value: string) {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveUrlKey(key)) url.searchParams.set(key, redacted);
    }
    const segments = url.pathname.split("/").map((segment, index, segmentsList) => {
      if (!segment) return segment;
      const previous = segmentsList[index - 1] ?? "";
      if (isSensitiveUrlKey(previous) || isCredentialLike(segment)) return redacted;
      return segment;
    });
    url.pathname = segments.join("/");
    return url.toString().replace(/%5Bredacted%5D/gi, redacted);
  } catch {
    return value;
  }
}

function redactCredentialPatterns(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, `Bearer ${redacted}`)
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, redacted)
    .replace(/\bghp_[A-Za-z0-9_]{16,}\b/g, redacted)
    .replace(/\bxoxb-[A-Za-z0-9-]{16,}\b/g, redacted)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, redacted)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, redacted);
}

function capJsonObject(value: unknown, limitBytes = jsonFieldLimitBytes): Record<string, unknown> {
  const object = isRecord(value) ? value : { value };
  const raw = JSON.stringify(object);
  const originalBytes = Buffer.byteLength(raw);
  if (originalBytes <= limitBytes) return object;
  const preview = truncateUtf8(raw, Math.min(maxStringBytes, limitBytes - 256));
  return {
    truncated: true,
    originalBytes,
    retainedBytes: Buffer.byteLength(preview),
    preview
  };
}

function truncateUtf8(value: string, limitBytes: number) {
  if (Buffer.byteLength(value) <= limitBytes) return value;
  const buffer = Buffer.from(value);
  return `${buffer.subarray(0, Math.max(0, limitBytes - 32)).toString("utf8").replace(/\uFFFD+$/g, "")}...`;
}

function isSensitiveKey(key: string) {
  return /(^|[_-])(authorization|cookie|set-cookie|password|passwd|secret|api[_-]?key|token|access[_-]?token|refresh[_-]?token|session|service[_-]?role|webhook[_-]?secret|private[_-]?key)([_-]|$)/i.test(
    key
  );
}

function isSensitiveUrlKey(key: string) {
  return /^(token|key|api_key|apikey|secret|signature|sig|session|password|pass|auth|authorization|code|access_token|refresh_token)$/i.test(
    key
  );
}

function isCredentialLike(value: string) {
  return /^(sk-|ghp_|xoxb-|AKIA|eyJ)/.test(value);
}

function isBinaryOrHtmlKey(key: string, value: unknown) {
  if (typeof value !== "string") return /bytes|buffer|base64|b64/i.test(key);
  if (/bytes|buffer|base64|b64/i.test(key)) return true;
  return isLikelyRawHtml(value) && /html|markup|document/i.test(key);
}

function isCrawlTextKey(key: string) {
  return /crawl|extracted/i.test(key);
}

function isLikelyRawHtml(value: string) {
  return value.length > 512 && /<html[\s>]|<!doctype html|<body[\s>]|<script[\s>]/i.test(value);
}

function isBase64Image(value: string) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) || (/^[A-Za-z0-9+/=]{2048,}$/.test(value) && value.length % 4 === 0);
}

function hostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function elapsedMs(startedAt: string, endedAt: string) {
  const started = new Date(startedAt).getTime();
  const ended = new Date(endedAt).getTime();
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
