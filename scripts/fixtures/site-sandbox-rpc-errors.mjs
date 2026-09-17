import { FileClient } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";

const responses = {
  file_not_found: { code: "FILE_NOT_FOUND", message: "File not found: /workspace/site/operations/probe.json", context: { path: "/workspace/site/operations/probe.json" }, httpStatus: 404, operation: "read_file", timestamp: "2026-09-17T00:00:00.000Z" },
  permission_denied: { code: "PERMISSION_DENIED", message: "Permission denied: /workspace/site/operations/probe.json", context: { path: "/workspace/site/operations/probe.json" }, httpStatus: 403, operation: "read_file", timestamp: "2026-09-17T00:00:00.000Z" },
  session_destroyed: { code: "SESSION_DESTROYED", message: "Session was destroyed", context: { sessionId: "probe" }, httpStatus: 410, operation: "read_file", timestamp: "2026-09-17T00:00:00.000Z" }
};

function sdkReadFailure(kind) {
  const body = responses[kind];
  const stub = { containerFetch: async () => Response.json(body, { status: body.httpStatus }) };
  return new FileClient({ stub }).readFile("/workspace/site/operations/probe.json", "probe", { encoding: "utf8" });
}

export class ErrorProbe extends DurableObject {
  async throwSdkError(kind) { await sdkReadFailure(kind); }
  async throwRawEnoent() {
    const error = new Error("ENOENT: no such file or directory");
    error.code = "ENOENT";
    throw error;
  }
  async returnStructured(kind) {
    try { await sdkReadFailure(kind); return { ok: true }; }
    catch (error) { return { ok: false, error: error.errorResponse }; }
  }
}

function shape(error) {
  return { name: error?.name, message: error?.message, code: error?.code, errorResponse: error?.errorResponse,
    ownKeys: error && typeof error === "object" ? Object.keys(error).sort() : [] };
}

export default {
  async fetch(request, env) {
    const [mode, kind] = new URL(request.url).pathname.slice(1).split("/");
    const stub = env.PROBE.getByName("rpc-error-shape");
    if (mode === "throw") {
      try {
        if (kind === "raw_enoent") await stub.throwRawEnoent();
        else await stub.throwSdkError(kind);
        return Response.json({ reached: false }, { status: 500 });
      } catch (error) { return Response.json({ reached: true, ...shape(error) }); }
    }
    if (mode === "structured") return Response.json(await stub.returnStructured(kind));
    return new Response("not found", { status: 404 });
  }
};
