import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { managerToolArguments, managerToolNameSchema, type ManagerToolName } from "@/packages/site-agent/contracts";
import {
  authenticateExternalMcp,
  claimNextExternalSite,
  executeExternalWorkspaceTool,
  getExternalExecutionStatus,
  recordExternalMcpRequest,
  type ExternalMcpToolName
} from "@/packages/external-authoring/mcp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1_200;

const maximumRequestBytes = 6 * 1024 * 1024;
const claimSchema = z.object({
  workerKey: z.string().min(8).max(160)
}).strict();
const claimEnvelope = {
  claimId: z.string().min(1).max(160),
  capability: z.string().min(32).max(256)
};
const statusSchema = z.object(claimEnvelope).strict();
const operationEnvelope = {
  ...claimEnvelope,
  expectedStateRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(8).max(160)
};

export async function GET(request: Request) {
  return handleMcp(request);
}

export async function POST(request: Request) {
  return handleMcp(request);
}

export async function DELETE(request: Request) {
  return handleMcp(request);
}

async function handleMcp(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maximumRequestBytes) return jsonError("MCP request is too large.", 413);
  const credential = await authenticateExternalMcp(request);
  if (!credential) return jsonError("Bearer authorization required.", 401);
  const authorizedCredential = credential;
  const bindingId = request.headers.get("mcp-session-id")?.trim()
    || request.headers.get("x-lodesta-claim-binding")?.trim()
    || `credential_${credential.id}`;
  let parsedBody: unknown;
  if (request.method === "POST") {
    const body = await request.text();
    if (Buffer.byteLength(body) > maximumRequestBytes) return jsonError("MCP request is too large.", 413);
    try {
      parsedBody = JSON.parse(body);
    } catch {
      return jsonError("MCP request body is invalid JSON.", 400);
    }
  }
  const server = new McpServer({
    name: "lodesta-external-authoring",
    version: "1.0.0"
  });

  server.registerTool("claim_next_site", {
    title: "Claim next prepared Lodesta site",
    description: "Claims or reconnects to the next operator-authorized prospect website. The returned capability is required for every workspace call.",
    inputSchema: claimSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async ({ workerKey }) => {
    await enforceRate("claim_next_site");
    return mcpResult(await claimNextExternalSite({ bindingId, workerKey }));
  });

  server.registerTool("get_execution_status", {
    title: "Get Lodesta authoring status",
    description: "Returns durable execution, claim, operation, and finalization status without changing the website.",
    inputSchema: statusSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async (args) => {
    await enforceRate("get_execution_status");
    return mcpResult(await getExternalExecutionStatus(args));
  });

  for (const toolName of managerToolNameSchema.options) {
    if (toolName === "create_image") continue;
    registerWorkspaceTool(server, toolName, enforceRate);
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  await server.connect(transport);
  return transport.handleRequest(request, parsedBody === undefined ? undefined : { parsedBody });

  async function enforceRate(toolName: ExternalMcpToolName) {
    const requests = await recordExternalMcpRequest({ credential: authorizedCredential, toolName, accepted: true });
    if (requests > 120) throw new Error("external_mcp_rate_limit");
  }
}

function registerWorkspaceTool(
  server: McpServer,
  toolName: Exclude<ManagerToolName, "create_image">,
  enforceRate: (toolName: ExternalMcpToolName) => Promise<void>
) {
  const core = managerToolArguments[toolName];
  const inputSchema = z.object({
    ...operationEnvelope,
    ...core.shape
  }).strict();
  server.registerTool(toolName, {
    title: workspaceToolTitle(toolName),
    description: workspaceToolDescription(toolName),
    inputSchema,
    annotations: {
      readOnlyHint: toolName === "list_files" || toolName === "search_files" || toolName === "read_files",
      destructiveHint: toolName === "delete_file",
      idempotentHint: true,
      openWorldHint: false
    }
  }, async (raw) => {
    await enforceRate(toolName);
    const {
      claimId,
      capability,
      expectedStateRevision,
      idempotencyKey,
      ...argumentsValue
    } = raw as typeof raw & {
      claimId: string;
      capability: string;
      expectedStateRevision: number;
      idempotencyKey: string;
    };
    const result = await executeExternalWorkspaceTool({
      claimId,
      capability,
      expectedStateRevision,
      idempotencyKey,
      toolName,
      arguments: argumentsValue,
      signal: AbortSignal.timeout(toolName === "inspect_site" || toolName === "finish" ? 20 * 60_000 : 10 * 60_000)
    });
    return mcpResult(result);
  });
}

function mcpResult(value: unknown) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [];
  const record = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  const modelOutput = record?.modelOutput;
  if (Array.isArray(modelOutput)) {
    for (const item of modelOutput) {
      if (!item || typeof item !== "object") continue;
      const block = item as Record<string, unknown>;
      if (block.type === "input_image" && typeof block.image_url === "string") {
        const parsed = block.image_url.match(/^data:([^;,]+);base64,(.+)$/);
        if (parsed) content.push({ type: "image", mimeType: parsed[1], data: parsed[2] });
      }
      if (block.type === "input_text" && typeof block.text === "string") {
        content.push({ type: "text", text: block.text });
      }
    }
  }
  content.unshift({ type: "text", text: JSON.stringify(redactImageData(value)) });
  return { content };
}

function redactImageData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactImageData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if ((key === "image_url" || key === "data") && typeof item === "string" && item.length > 1_000) {
      return [key, "[image returned as MCP image content]"];
    }
    return [key, redactImageData(item)];
  }));
}

function workspaceToolTitle(toolName: string) {
  return toolName.split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function workspaceToolDescription(toolName: Exclude<ManagerToolName, "create_image">) {
  const descriptions: Record<Exclude<ManagerToolName, "create_image">, string> = {
    list_files: "Lists the current durable authoring workspace.",
    search_files: "Finds literal text across the current durable authoring workspace.",
    read_files: "Reads bounded ranges from one or more source files.",
    write_file: "Creates or replaces one safe source file.",
    delete_file: "Deletes one safe source file; it cannot delete sites, artifacts, prospects, or ownership.",
    apply_patch: "Atomically applies a bounded multi-file content patch.",
    edit_file: "Applies exact hash-guarded line edits to one existing source file.",
    build_preview: "Builds the current workspace in Lodesta's sandbox. This may take several minutes.",
    inspect_site: "Runs Lodesta's browser and hard-gate inspection. This may take several minutes.",
    request_input: "Pauses before mutation for one consequential operator clarification.",
    finish: "Runs the hard gate and atomically creates the candidate and private preview when it passes."
  };
  return descriptions[toolName];
}

function jsonError(message: string, status: number) {
  return Response.json({
    jsonrpc: "2.0",
    error: { code: -32001, message },
    id: null,
    requestId: randomUUID()
  }, {
    status,
    headers: {
      "cache-control": "no-store",
      "www-authenticate": status === 401 ? 'Bearer realm="lodesta-mcp"' : ""
    }
  });
}
