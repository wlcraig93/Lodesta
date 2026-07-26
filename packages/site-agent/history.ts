import type { ResponseInputItem } from "openai/resources/responses/responses";
import { sha256, stableJson } from "@/packages/business-data";
import type { ManagerToolName } from "./contracts";

export type CompactHistoryRecord = {
  schemaVersion: 1;
  kind: "compact-history-record";
  callId: string;
  toolName: ManagerToolName | "no_tool_response";
  status: "succeeded" | "failed";
  inputHash: `sha256:${string}`;
  outputHash: `sha256:${string}`;
  workspaceHashBefore?: string;
  workspaceHashAfter?: string;
  detail: Record<string, unknown>;
};

type HistoryEntry = {
  raw: ResponseInputItem[];
  compact: ResponseInputItem;
  compactRecord: CompactHistoryRecord;
  retainThroughRequest?: number;
  retainUntilBoundary: boolean;
  boundaryReached: boolean;
  read?: { path: string; contentHash: string };
  compacted: boolean;
};

export class DeterministicManagerHistory {
  private readonly entries: HistoryEntry[] = [];
  private readonly compactedReadHashes = new Map<string, string>();
  private rereads = 0;

  constructor(private readonly stablePrefix: ResponseInputItem[]) {}

  prefixItems() {
    return this.stablePrefix;
  }

  prefixHash() {
    return sha256(stableJson(this.stablePrefix));
  }

  requestItems(requestIndex: number) {
    return [
      ...this.stablePrefix,
      ...this.activeTailItems(requestIndex)
    ];
  }

  activeTailItems(requestIndex: number) {
    return this.entries.flatMap((entry) => {
      const retainForRequest = entry.retainThroughRequest !== undefined && requestIndex <= entry.retainThroughRequest;
      const retainForBoundary = entry.retainUntilBoundary && !entry.boundaryReached;
      if (retainForRequest || retainForBoundary) return entry.raw;
      if (!entry.compacted) {
        entry.compacted = true;
        if (entry.read) this.compactedReadHashes.set(entry.read.path, entry.read.contentHash);
      }
      return [entry.compact];
    });
  }

  noteNoToolResponse(input: {
    responseItems: ResponseInputItem[];
    responseIndex: number;
  }) {
    const record = compactRecord({
      callId: `no_tool_${input.responseIndex}`,
      toolName: "no_tool_response",
      status: "failed",
      arguments: {},
      diagnostic: { noToolResponse: true }
    });
    this.entries.push({
      raw: input.responseItems,
      compact: compactMessage(record),
      compactRecord: record,
      retainThroughRequest: input.responseIndex + 1,
      retainUntilBoundary: false,
      boundaryReached: false,
      compacted: false
    });
  }

  noteTool(input: {
    responseItems: ResponseInputItem[];
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
    const boundary = input.workspaceMutated || input.toolName === "build_preview";
    if (boundary) {
      for (const entry of this.entries) {
        if (entry.retainUntilBoundary) entry.boundaryReached = true;
      }
    }
    if (input.workspaceMutated) {
      for (const path of mutatedPaths(input.toolName, input.arguments)) this.compactedReadHashes.delete(path);
    }

    const read = input.toolName === "read_file"
      && input.status === "succeeded"
      && typeof input.diagnostic.path === "string"
      && typeof input.diagnostic.contentHash === "string"
      ? { path: input.diagnostic.path, contentHash: input.diagnostic.contentHash }
      : undefined;
    if (read && this.compactedReadHashes.get(read.path) === read.contentHash) this.rereads += 1;

    const imageMetadata = compactedImageMetadata(input.functionOutput, input.toolName);
    const diagnostic = imageMetadata.length
      ? { ...input.diagnostic, imageMetadata }
      : input.diagnostic;
    const record = compactRecord({
      callId: input.callId,
      toolName: input.toolName,
      status: input.status,
      arguments: input.arguments,
      diagnostic,
      workspaceHashBefore: input.workspaceHashBefore,
      workspaceHashAfter: input.workspaceHashAfter
    });
    const retainUntilBoundary = Boolean(read)
      || (input.status === "failed" && ["build_preview", "inspect_site", "finish"].includes(input.toolName));
    this.entries.push({
      raw: [...input.responseItems, input.functionOutput],
      compact: compactMessage(record),
      compactRecord: record,
      retainThroughRequest: retainUntilBoundary ? undefined : input.responseIndex + 1,
      retainUntilBoundary,
      boundaryReached: false,
      read,
      compacted: false
    });
  }

  compactedPathRereads() {
    return this.rereads;
  }

  compactedRecords() {
    return this.entries.filter((entry) => entry.compacted).map((entry) => entry.compactRecord);
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
  const activeTailValue = [...input.activeTail, input.runtimeState];
  const requestValue = {
    ...stablePrefixValue,
    input: [...input.stablePrefix, ...activeTailValue]
  };
  const images = imageDetails(requestValue);
  return {
    requestIndex: input.requestIndex,
    initialPromptBytes: input.requestIndex === 1 ? bytes(requestValue) : undefined,
    stablePrefixBytes: bytes(stablePrefixValue),
    stablePrefixHash: sha256(stableJson(stablePrefixValue)),
    activeTailBytes: bytes(activeTailValue),
    requestPayloadBytes: bytes(requestValue),
    imageCount: images.high + images.low,
    highDetailImageCount: images.high,
    lowDetailImageCount: images.low
  };
}

function compactRecord(input: {
  callId: string;
  toolName: CompactHistoryRecord["toolName"];
  status: CompactHistoryRecord["status"];
  arguments: Record<string, unknown>;
  diagnostic: Record<string, unknown>;
  workspaceHashBefore?: string;
  workspaceHashAfter?: string;
}): CompactHistoryRecord {
  return {
    schemaVersion: 1,
    kind: "compact-history-record",
    callId: input.callId,
    toolName: input.toolName,
    status: input.status,
    inputHash: sha256(stableJson({ toolName: input.toolName, arguments: input.arguments })),
    outputHash: sha256(stableJson(input.diagnostic)),
    workspaceHashBefore: input.workspaceHashBefore,
    workspaceHashAfter: input.workspaceHashAfter,
    detail: compactDetail(input.toolName, input.arguments, input.diagnostic)
  };
}

function compactDetail(
  toolName: CompactHistoryRecord["toolName"],
  args: Record<string, unknown>,
  output: Record<string, unknown>
) {
  if (toolName === "read_file") {
    return pick(output, ["ok", "error", "path", "contentHash", "startLine", "endLine", "totalLines", "bytes"]);
  }
  if (toolName === "write_file") {
    return {
      ...pick(output, ["ok", "error", "unchanged", "path", "contentHash", "workspaceHash"]),
      bytes: typeof args.content === "string" ? Buffer.byteLength(args.content) : undefined
    };
  }
  if (toolName === "delete_file") {
    return pick(output, ["ok", "error", "unchanged", "path", "deleted", "workspaceHash"]);
  }
  if (toolName === "apply_patch") {
    const files = Array.isArray(args.files) ? args.files : [];
    return {
      ...pick(output, ["ok", "error", "unchanged", "changedFiles", "workspaceHash"]),
      files: files.flatMap((value) => {
        const file = objectValue(value);
        return typeof file?.path === "string"
          ? [{
              path: file.path,
              operation: file.content === null ? "delete" : "write",
              bytes: typeof file.content === "string" ? Buffer.byteLength(file.content) : 0
            }]
          : [];
      })
    };
  }
  if (toolName === "create_image") {
    return {
      ...pick(output, ["ok", "error", "assetId", "revisionId", "width", "height", "contentHash", "publicBuildInputId", "imageMetadata"]),
      purpose: typeof args.purpose === "string" ? args.purpose : undefined,
      alt: typeof args.alt === "string" ? args.alt : undefined
    };
  }
  if (toolName === "build_preview") {
    return pick(output, ["ok", "error", "cached", "workspaceHash", "sandboxRevision", "previewPath", "failureFingerprint", "diagnostic", "guidance"]);
  }
  if (toolName === "inspect_site" || toolName === "finish") {
    return pick(output, ["ok", "error", "cached", "workspaceHash", "inspectionHash", "failureFingerprint", "guidance", "blockerCount", "uniqueBlockerCount", "returnedBlockerCount", "blockersTruncated", "screenshotKeys", "imageMetadata"]);
  }
  if (toolName === "request_input") return pick(output, ["ok", "error", "needsInput"]);
  if (toolName === "list_files") return pick(output, ["ok", "error", "workspaceHash", "files"]);
  return pick(output, ["ok", "error", "noToolResponse"]);
}

function compactMessage(record: CompactHistoryRecord): ResponseInputItem {
  return {
    role: "user",
    type: "message",
    content: [{
      type: "input_text",
      text: `Deterministic prior tool record:\n${JSON.stringify(record)}`
    }]
  };
}

function compactedImageMetadata(functionOutput: ResponseInputItem, toolName: ManagerToolName) {
  if (functionOutput.type !== "function_call_output" || !Array.isArray(functionOutput.output)) return [];
  return functionOutput.output.flatMap((item, index) => {
    const value = objectValue(item);
    if (value?.type !== "input_image" || typeof value.image_url !== "string") return [];
    const match = value.image_url.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match?.[2]) return [];
    const pixels = Buffer.from(match[2], "base64");
    const dimensions = imageDimensions(pixels, match[1]);
    return [{
      identity: sha256(pixels),
      purpose: toolName === "create_image" ? "generated_asset" : "verification_capture",
      bytes: pixels.length,
      ...(dimensions ?? {}),
      detail: value.detail === "low" ? "low" : "high",
      index
    }];
  });
}

function imageDimensions(bytes: Buffer, mimeType: string | undefined) {
  if (mimeType === "image/png"
    && bytes.length >= 24
    && bytes.subarray(1, 4).toString("ascii") === "PNG") {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20)
    };
  }
  return undefined;
}

function mutatedPaths(toolName: ManagerToolName, args: Record<string, unknown>) {
  if ((toolName === "write_file" || toolName === "delete_file") && typeof args.path === "string") return [args.path];
  if (toolName !== "apply_patch" || !Array.isArray(args.files)) return [];
  return args.files.flatMap((value) => {
    const file = objectValue(value);
    return typeof file?.path === "string" ? [file.path] : [];
  });
}

function pick(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.flatMap((key) => value[key] === undefined ? [] : [[key, value[key]]]));
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function bytes(value: unknown) {
  return Buffer.byteLength(stableJson(value));
}

function imageDetails(value: unknown) {
  const result = { high: 0, low: 0 };
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
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(value);
  return result;
}
