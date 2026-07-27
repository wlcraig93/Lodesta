import type {
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  Tool
} from "openai/resources/responses/responses";
import type { ManagerResponsesClient } from "./manager";

type JsonRecord = Record<string, unknown>;

export function openRouterAnthropicMessagesClient(input: {
  apiKey: string;
  headers: Record<string, string>;
}): ManagerResponsesClient {
  return {
    async create(params, options) {
      const response = await fetch("https://openrouter.ai/api/v1/messages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          ...input.headers
        },
        body: JSON.stringify(anthropicMessagesRequest(params)),
        signal: options?.signal
      });
      const payload = parseJson(await response.text());
      if (!response.ok) throw providerError(response.status, payload);
      return anthropicMessagesResponse(payload);
    }
  };
}

export function anthropicMessagesRequest(params: ResponseCreateParamsNonStreaming) {
  const extension = params as ResponseCreateParamsNonStreaming & {
    provider?: JsonRecord;
    session_id?: string;
  };
  return {
    model: params.model,
    max_tokens: params.max_output_tokens ?? 64_000,
    system: typeof params.instructions === "string"
      ? [{ type: "text", text: params.instructions }]
      : params.instructions,
    messages: anthropicMessages(params.input),
    tools: anthropicTools(params.tools ?? []),
    tool_choice: {
      type: params.tool_choice === "none" ? "none" : "any",
      disable_parallel_tool_use: params.parallel_tool_calls === false
    },
    thinking: { type: "adaptive" },
    output_config: {
      effort: params.reasoning?.effort ?? "high"
    },
    ...(extension.provider ? { provider: extension.provider } : {}),
    ...(extension.session_id ? { session_id: extension.session_id } : {})
  };
}

export function anthropicMessagesResponse(value: unknown) {
  const response = requiredRecord(value, "anthropic_messages_response");
  const content = Array.isArray(response.content) ? response.content : [];
  const output: ResponseInputItem[] = content.flatMap((raw): ResponseInputItem[] => {
    const block = objectValue(raw);
    if (!block) return [];
    if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
      return [{
        type: "function_call",
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
        status: "completed"
      } as ResponseInputItem];
    }
    if (block.type === "thinking" || block.type === "redacted_thinking") {
      return [{
        type: "anthropic_thinking",
        block
      } as unknown as ResponseInputItem];
    }
    if (block.type === "text" && typeof block.text === "string") {
      return [{
        type: "message",
        role: "assistant",
        content: block.text
      } as ResponseInputItem];
    }
    return [];
  });
  const usage = objectValue(response.usage) ?? {};
  const inputTokens = nonnegativeNumber(usage.input_tokens);
  const cacheCreationInputTokens = nonnegativeNumber(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = nonnegativeNumber(usage.cache_read_input_tokens);
  const outputTokens = nonnegativeNumber(usage.output_tokens);
  const stopReason = typeof response.stop_reason === "string" ? response.stop_reason : undefined;
  return {
    id: typeof response.id === "string" ? response.id : "anthropic_message_unknown",
    model: typeof response.model === "string" ? response.model : "anthropic/claude-opus-5",
    output,
    output_text: content
      .map(objectValue)
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block!.text as string)
      .join("\n"),
    status: stopReason === "max_tokens" ? "incomplete" as const : "completed" as const,
    error: null,
    incomplete_details: stopReason === "max_tokens"
      ? { reason: "max_output_tokens" as const }
      : null,
    usage: {
      input_tokens: inputTokens + cacheCreationInputTokens + cacheReadInputTokens,
      input_tokens_details: {
        cached_tokens: cacheReadInputTokens,
        cache_write_tokens: cacheCreationInputTokens
      },
      output_tokens: outputTokens,
      output_tokens_details: {
        reasoning_tokens: nonnegativeNumber(objectValue(usage.output_tokens_details)?.reasoning_tokens)
      },
      total_tokens: inputTokens + cacheCreationInputTokens + cacheReadInputTokens + outputTokens,
      cost: optionalNumber(usage.cost),
      cost_details: objectValue(usage.cost_details) as { upstream_inference_cost?: number | null } | undefined
    },
    openrouter_metadata: response.openrouter_metadata
  };
}

function anthropicMessages(value: ResponseCreateParamsNonStreaming["input"]) {
  const items = Array.isArray(value) ? value : [{
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: String(value ?? "") }]
  }];
  const messages: Array<{ role: "user" | "assistant"; content: unknown[] }> = [];
  for (const raw of items) {
    const item = raw as unknown as JsonRecord;
    const converted = anthropicItem(item);
    if (!converted) continue;
    const previous = messages.at(-1);
    if (previous?.role === converted.role) previous.content.push(...converted.content);
    else messages.push(converted);
  }
  return messages;
}

function anthropicItem(item: JsonRecord): { role: "user" | "assistant"; content: unknown[] } | undefined {
  if (item.type === "message" && (item.role === "user" || item.role === "assistant")) {
    return {
      role: item.role,
      content: anthropicContent(item.content)
    };
  }
  if (item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string") {
    return {
      role: "assistant",
      content: [{
        type: "tool_use",
        id: item.call_id,
        name: item.name,
        input: typeof item.arguments === "string" ? parseJson(item.arguments) : {}
      }]
    };
  }
  if (item.type === "function_call_output" && typeof item.call_id === "string") {
    return {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: item.call_id,
        content: anthropicToolResultContent(item.output)
      }]
    };
  }
  if (item.type === "anthropic_thinking") {
    const block = objectValue(item.block);
    if (block) return { role: "assistant", content: [block] };
  }
  return undefined;
}

function anthropicContent(value: unknown) {
  if (typeof value === "string") return [{ type: "text", text: value }];
  if (!Array.isArray(value)) return [];
  const content: unknown[] = [];
  for (const raw of value) {
    const block = objectValue(raw);
    if (!block) continue;
    if ((block.type === "input_text" || block.type === "output_text") && typeof block.text === "string") {
      content.push({
        type: "text",
        text: block.text,
        ...(block.prompt_cache_breakpoint ? { cache_control: { type: "ephemeral" } } : {})
      });
      continue;
    }
    if (block.type === "input_image" && typeof block.image_url === "string") {
      const source = anthropicImageSource(block.image_url);
      if (source) {
        content.push({
          type: "image",
          source,
          ...(block.prompt_cache_breakpoint ? { cache_control: { type: "ephemeral" } } : {})
        });
      }
    }
  }
  return content;
}

function anthropicToolResultContent(value: unknown) {
  if (typeof value === "string") return value;
  const content = anthropicContent(value);
  return content.length ? content : JSON.stringify(value ?? null);
}

function anthropicImageSource(value: string) {
  const data = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (data) {
    return {
      type: "base64",
      media_type: data[1],
      data: data[2]
    };
  }
  if (/^https:\/\//.test(value)) return { type: "url", url: value };
  return undefined;
}

function anthropicTools(tools: Tool[]) {
  return tools.flatMap((tool) => {
    if (tool.type !== "function") return [];
    return [{
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
      strict: tool.strict === true
    }];
  });
}

function providerError(status: number, value: unknown) {
  const payload = objectValue(value);
  const error = objectValue(payload?.error);
  const failure = new Error(
    typeof error?.message === "string"
      ? error.message
      : `openrouter_anthropic_messages_failed:${status}`
  ) as Error & { status: number; error?: unknown };
  failure.status = status;
  failure.error = error;
  return failure;
}

function requiredRecord(value: unknown, label: string) {
  const record = objectValue(value);
  if (!record) throw new Error(`${label}_invalid`);
  return record;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function objectValue(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function nonnegativeNumber(value: unknown) {
  const number = optionalNumber(value);
  return number !== undefined && number >= 0 ? number : 0;
}

function optionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
