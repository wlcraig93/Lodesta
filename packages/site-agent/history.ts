import type { ResponseInputItem } from "openai/resources/responses/responses";
import { sha256, stableJson } from "@/packages/business-data";
import type { ManagerToolName } from "./contracts";

/**
 * Stateless Responses replay preserves every model output item so encrypted
 * reasoning remains available across tool turns. When OpenAI emits an opaque
 * compaction item, that item becomes the canonical history boundary and older
 * input items are discarded exactly as the Responses API contract permits.
 */
export class DeterministicManagerHistory {
  private prefix: ResponseInputItem[];
  private readonly tail: ResponseInputItem[] = [];
  private readonly pending: ResponseInputItem[] = [];
  private readonly readHashes = new Map<string, string>();
  private rereads = 0;
  private compactions = 0;
  private prunedItems = 0;

  constructor(stablePrefix: ResponseInputItem[], restoredItems: ResponseInputItem[] = []) {
    this.prefix = [...stablePrefix];
    if (restoredItems.length) this.restore(restoredItems);
  }

  prefixItems() {
    return [...this.prefix];
  }

  prefixHash() {
    return sha256(stableJson(this.prefix));
  }

  requestItems(_requestIndex?: number) {
    return [...this.prefix, ...this.tail];
  }

  activeTailItems(_requestIndex?: number) {
    // A tool call does not prove that every preview was understood or is no
    // longer needed. Keep labels and pixels together until provider compaction
    // replaces their history, exactly as we retain other tool evidence.
    return [...this.tail];
  }

  appendRuntimeState(item: ResponseInputItem) {
    this.tail.push(item);
    this.pending.push(item);
  }

  noteNoToolResponse(input: {
    responseItems: ResponseInputItem[];
    responseIndex: number;
  }) {
    this.appendResponseItems(input.responseItems);
    this.tail.push(
      {
        role: "user",
        type: "message",
        content: [{ type: "input_text", text: "Continue the website task using the available workspace tools." }]
      }
    );
    this.pending.push(
      {
        role: "user",
        type: "message",
        content: [{ type: "input_text", text: "Continue the website task using the available workspace tools." }]
      }
    );
  }

  noteTool(input: {
    responseItems: ResponseInputItem[];
    includeResponseItems?: boolean;
    functionOutput: ResponseInputItem;
    responseIndex: number;
    callId: string;
    toolName: ManagerToolName;
    status: "succeeded" | "failed";
    arguments: Record<string, unknown>;
    diagnostic: Record<string, unknown>;
    workspaceHashBefore?: string;
    workspaceHashAfter?: string;
    workspaceMutated: boolean;
  }) {
    if (input.workspaceMutated) {
      for (const path of mutatedPaths(input.toolName, input.arguments)) this.readHashes.delete(path);
    }
    if (input.toolName === "read_files" && input.status === "succeeded" && Array.isArray(input.diagnostic.files)) {
      for (const value of input.diagnostic.files) {
        const file = objectValue(value);
        if (file?.ok !== true || typeof file.path !== "string" || typeof file.contentHash !== "string") continue;
        if (this.readHashes.get(file.path) === file.contentHash) this.rereads += 1;
        this.readHashes.set(file.path, file.contentHash);
      }
    }
    if (input.includeResponseItems !== false) this.appendResponseItems(input.responseItems);
    this.tail.push(input.functionOutput);
    this.pending.push(input.functionOutput);
  }

  drainContinuationItems() {
    const items = [...this.pending];
    this.pending.length = 0;
    return items;
  }

  unchangedPathRereads() {
    return this.rereads;
  }

  compactionCount() {
    return this.compactions;
  }

  compactedHistoryItems() {
    return this.prunedItems;
  }

  private appendResponseItems(items: ResponseInputItem[]) {
    let latestCompactionIndex = -1;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (!isCompactionItem(items[index]!)) continue;
      latestCompactionIndex = index;
      break;
    }
    if (latestCompactionIndex < 0) {
      this.tail.push(...items);
      this.pending.push(...items);
      return;
    }
    this.compactions += items.filter(isCompactionItem).length;
    this.prunedItems += this.prefix.length + this.tail.length + latestCompactionIndex;
    this.prefix = [];
    this.tail.length = 0;
    const retained = items.slice(latestCompactionIndex);
    this.tail.push(...retained);
    this.pending.length = 0;
    this.pending.push(...retained);
  }

  private restore(items: ResponseInputItem[]) {
    let latestCompactionIndex = -1;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (!isCompactionItem(items[index]!)) continue;
      latestCompactionIndex = index;
      break;
    }
    if (latestCompactionIndex >= 0) {
      this.prefix = [];
      this.tail.push(...items.slice(latestCompactionIndex));
      this.compactions = items.filter(isCompactionItem).length;
      this.prunedItems = latestCompactionIndex;
      return;
    }
    this.tail.push(...items);
  }
}

export function managerPromptTelemetry(input: {
  instructions: string;
  tools: unknown;
  stablePrefix: ResponseInputItem[];
  activeTail: ResponseInputItem[];
  runtimeState: ResponseInputItem;
  requestIndex: number;
}) {
  const stablePrefixValue = {
    instructions: input.instructions,
    tools: input.tools,
    input: input.stablePrefix
  };
  const appendedTailValue = input.activeTail;
  const activeTailValue = input.activeTail;
  const activeHistoryValue = [...input.stablePrefix, ...activeTailValue];
  const requestValue = {
    ...stablePrefixValue,
    input: activeHistoryValue
  };
  const images = imageDetails(requestValue);
  const stableImages = imageDetails(input.stablePrefix);
  const tailImages = imageDetails(input.activeTail);
  return {
    requestIndex: input.requestIndex,
    initialPromptBytes: input.requestIndex === 1 ? bytes(requestValue) : undefined,
    stablePrefixBytes: bytes(stablePrefixValue),
    stablePrefixHash: sha256(stableJson(stablePrefixValue)),
    appendedTailBytes: bytes(appendedTailValue),
    activeTailBytes: bytes(activeTailValue),
    activeHistoryBytes: bytes(activeHistoryValue),
    runtimeStateBytes: bytes(input.runtimeState),
    requestPayloadBytes: bytes(requestValue),
    imageCount: images.high + images.low,
    highDetailImageCount: images.high,
    lowDetailImageCount: images.low,
    stableMediaBytes: stableImages.bytes,
    screenshotBytes: tailImages.bytes,
    totalImageBytes: images.bytes
  };
}

function mutatedPaths(toolName: ManagerToolName, args: Record<string, unknown>) {
  if ((toolName === "write_file" || toolName === "delete_file" || toolName === "edit_file") && typeof args.path === "string") return [args.path];
  if (toolName !== "apply_patch" || !Array.isArray(args.files)) return [];
  return args.files.flatMap((value) => {
    const file = objectValue(value);
    return typeof file?.path === "string" ? [file.path] : [];
  });
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isCompactionItem(value: ResponseInputItem) {
  return objectValue(value)?.type === "compaction";
}

function bytes(value: unknown) {
  return Buffer.byteLength(stableJson(value));
}

function imageDetails(value: unknown) {
  const result = { high: 0, low: 0, bytes: 0 };
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      for (const nested of item) visit(nested);
      return;
    }
    const record = objectValue(item);
    if (!record) return;
    if (record.type === "input_image") {
      if (record.detail === "low") result.low += 1;
      else result.high += 1;
      if (typeof record.image_url === "string") {
        const base64 = record.image_url.match(/^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/)?.[1];
        if (base64) result.bytes += Buffer.byteLength(base64, "base64");
      }
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(value);
  return result;
}
