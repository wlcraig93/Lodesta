/// <reference types="@cloudflare/workers-types" />

import {
  ContainerProxy,
  getSandbox,
  Sandbox as CloudflareSandbox,
  type Sandbox as SandboxDurableObject
} from "@cloudflare/sandbox";
import { sitePlatformVersionManifest } from "../../../packages/site-contracts/platform-versions";
import { sandboxSourcePolicyVersion } from "../scaffold/version-manifest";
export { ContainerProxy };

export class Sandbox extends CloudflareSandbox {
  enableInternet = false;
}

interface Env {
  Sandbox: DurableObjectNamespace<SandboxDurableObject>;
  ARTIFACT_BUCKET: R2Bucket;
  SANDBOX_TRANSPORT: "rpc";
  PLATFORM_TOKEN?: string;
}

type ApplyRequest = {
  expectedRevision: string;
  files: Array<{ path: string; content: string }>;
};

const workspaceRoot = "/workspace/site";
const revisionPath = `${workspaceRoot}/.lodesta/revision`;
const publicInputPath = `${workspaceRoot}/.lodesta/public-build-input.json`;
const previewPort = 4173;
const maxFilesPerApply = 80;
const maxApplyBytes = 4_000_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, provider: "cloudflare-sandbox", transport: env.SANDBOX_TRANSPORT });
    if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);

    const blobMatch = url.pathname.match(/^\/v1\/blobs\/(.+)$/);
    if (blobMatch) return blobRequest(request, env.ARTIFACT_BUCKET, decodeBlobKey(blobMatch[1]));

    const previewMatch = url.pathname.match(/^\/v1\/sessions\/([a-z0-9-]{1,80})\/preview(\/.*)?$/);
    if (request.method === "GET" && previewMatch) {
      const sandbox = sandboxFor(env, previewMatch[1]);
      const upstream = new URL(request.url);
      upstream.pathname = previewMatch[2] || "/";
      const response = await sandbox.containerFetch(new Request(upstream, request), previewPort);
      const headers = new Headers(response.headers);
      applyPreviewHeaders(headers);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    const match = url.pathname.match(/^\/v1\/sessions\/([a-z0-9-]{1,80})\/(bootstrap|apply|rebase|artifact|source|backup|restore|destroy|diagnostics)$/);
    if (!match) return json({ error: "not_found" }, 404);
    const sessionId = match[1];
    const action = match[2];
    const sandbox = sandboxFor(env, sessionId);

    try {
      if (request.method === "POST" && action === "bootstrap") {
        const body = await request.json() as { publicBuildInput?: unknown };
        if (!body.publicBuildInput || typeof body.publicBuildInput !== "object") return json({ error: "public_build_input_required" }, 400);
        await sandbox.exec(`rm -rf ${workspaceRoot} && mkdir -p ${workspaceRoot} && cp -R /opt/lodesta-site-scaffold/. ${workspaceRoot}/ && rm -rf ${workspaceRoot}/node_modules && ln -s /opt/lodesta-site-scaffold/node_modules ${workspaceRoot}/node_modules && mkdir -p ${workspaceRoot}/.lodesta`);
        await sandbox.writeFile(publicInputPath, JSON.stringify(body.publicBuildInput));
        const revision = await digest(`${sessionId}:${JSON.stringify(body.publicBuildInput)}`);
        await sandbox.writeFile(revisionPath, revision);
        return json({ ok: true, revision });
      }

      if (request.method === "POST" && action === "apply") {
        const body = validateApply(await request.json());
        const currentRevision = await readRevision(sandbox);
        if (currentRevision !== body.expectedRevision) return json({ error: "revision_conflict", currentRevision }, 409);
        const sourcePolicyInput = `/tmp/lodesta-source-policy-${await digest(`${sessionId}:${currentRevision}`)}.json`;
        await sandbox.writeFile(sourcePolicyInput, JSON.stringify(body.files));
        const sourcePolicy = await sandbox.exec(`npm run validate-source -- ${sourcePolicyInput}`, { cwd: workspaceRoot, timeout: 30_000 });
        await sandbox.deleteFile(sourcePolicyInput);
        if (!sourcePolicy.success) {
          return json({
            error: "source_policy_violation",
            ...parseSourcePolicyResult(sourcePolicy.stdout),
            detail: sourcePolicy.stderr.trim().slice(-4_000) || "Generated source failed the sandbox source policy."
          }, 422);
        }
        const rollbackSource = `/tmp/lodesta-source-rollback-${await digest(`${sessionId}:${currentRevision}`)}`;
        await sandbox.exec(`rm -rf ${rollbackSource} && cp -R ${workspaceRoot}/src ${rollbackSource}`);
        await sandbox.exec(`rm -rf ${workspaceRoot}/src && mkdir -p ${workspaceRoot}/src`);
        for (const file of body.files) {
          const path = `${workspaceRoot}/${file.path}`;
          await sandbox.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
          await sandbox.writeFile(path, file.content);
        }
        const buildStarted = Date.now();
        const build = await sandbox.exec("npm run build", { cwd: workspaceRoot, timeout: 120_000 });
        if (!build.success) {
          await sandbox.exec(`rm -rf ${workspaceRoot}/src && mv ${rollbackSource} ${workspaceRoot}/src`);
          return json({ error: "build_failed", stdout: build.stdout.slice(-12_000), stderr: build.stderr.slice(-12_000) }, 422);
        }
        await sandbox.exec(`rm -rf ${rollbackSource}`);
        const revision = await digest(`${currentRevision}:${JSON.stringify(body.files)}`);
        await sandbox.writeFile(revisionPath, revision);
        await sandbox.killAllProcesses();
        const server = await sandbox.startProcess(`npm run preview -- --host 0.0.0.0 --port ${previewPort}`, { cwd: workspaceRoot });
        await server.waitForPort(previewPort, { path: "/", status: 200, timeout: 30_000 });
        return json({
          ok: true,
          revision,
          previewUrl: `${url.origin}/v1/sessions/${sessionId}/preview/`,
          buildDurationMs: Date.now() - buildStarted,
          placementId: await sandbox.getContainerPlacementId()
        });
      }

      if (request.method === "POST" && action === "rebase") {
        const body = await request.json() as { expectedRevision?: unknown; publicBuildInput?: unknown };
        if (typeof body.expectedRevision !== "string" || !body.publicBuildInput || typeof body.publicBuildInput !== "object") {
          return json({ error: "invalid_rebase_request" }, 400);
        }
        const currentRevision = await readRevision(sandbox);
        if (currentRevision !== body.expectedRevision) return json({ error: "revision_conflict", currentRevision }, 409);
        await sandbox.writeFile(publicInputPath, JSON.stringify(body.publicBuildInput));
        const buildStarted = Date.now();
        const build = await sandbox.exec("npm run build", { cwd: workspaceRoot, timeout: 120_000 });
        if (!build.success) return json({ error: "build_failed", stdout: build.stdout.slice(-12_000), stderr: build.stderr.slice(-12_000) }, 422);
        const revision = await digest(`${currentRevision}:rebase:${JSON.stringify(body.publicBuildInput)}`);
        await sandbox.writeFile(revisionPath, revision);
        await sandbox.killAllProcesses();
        const server = await sandbox.startProcess(`npm run preview -- --host 0.0.0.0 --port ${previewPort}`, { cwd: workspaceRoot });
        await server.waitForPort(previewPort, { path: "/", status: 200, timeout: 30_000 });
        return json({
          ok: true,
          revision,
          previewUrl: `${url.origin}/v1/sessions/${sessionId}/preview/`,
          buildDurationMs: Date.now() - buildStarted,
          placementId: await sandbox.getContainerPlacementId()
        });
      }

      if (request.method === "GET" && action === "artifact") {
        const exists = await sandbox.exists(`${workspaceRoot}/dist/lodesta-artifact.json`);
        if (!exists.exists) return json({ error: "artifact_not_built" }, 404);
        const file = await sandbox.readFile(`${workspaceRoot}/dist/lodesta-artifact.json`, { encoding: "utf8" });
        if (file.content.length > 4_000_000) return json({ error: "artifact_too_large" }, 413);
        return new Response(file.content, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      }

      if (request.method === "GET" && action === "source") {
        const listed = await sandbox.exec(`find ${workspaceRoot}/src -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.json' \\) -print | sort`);
        if (!listed.success) return json({ error: "source_unavailable" }, 404);
        const paths = listed.stdout.trim().split("\n").filter(Boolean);
        if (paths.length > maxFilesPerApply) return json({ error: "source_file_limit" }, 413);
        const files = [];
        for (const absolutePath of paths) {
          if (!absolutePath.startsWith(`${workspaceRoot}/src/`) || absolutePath.includes("..")) return json({ error: "source_path_violation" }, 500);
          const file = await sandbox.readFile(absolutePath, { encoding: "utf8" });
          files.push({ path: absolutePath.slice(`${workspaceRoot}/`.length), content: file.content });
        }
        if (files.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0) > maxApplyBytes) {
          return json({ error: "source_payload_too_large" }, 413);
        }
        return json({ ok: true, revision: await readRevision(sandbox), files });
      }

      if (request.method === "POST" && action === "backup") {
        const revision = await readRevision(sandbox);
        if (revision === "uninitialized") return json({ error: "workspace_uninitialized" }, 409);
        const id = await digest(`${sessionId}:${revision}:${Date.now()}`);
        const archivePath = `/tmp/${id}.tar.gz`;
        const archived = await sandbox.exec(`tar --exclude=node_modules --exclude=dist -czf ${archivePath} -C ${workspaceRoot} .`, { timeout: 30_000 });
        if (!archived.success) return json({ error: "backup_failed", stderr: archived.stderr.slice(-8_000) }, 422);
        const archive = await sandbox.readFile(archivePath, { encoding: "none" });
        const fixed = new FixedLengthStream(archive.size);
        const upload = archive.content.pipeTo(fixed.writable);
        await env.ARTIFACT_BUCKET.put(workspaceBackupKey(id), fixed.readable, {
          httpMetadata: { contentType: "application/gzip" },
          customMetadata: { sessionId, revision, createdAt: new Date().toISOString() }
        });
        await upload;
        await sandbox.deleteFile(archivePath);
        return json({ ok: true, backup: { id, revision, size: archive.size, key: workspaceBackupKey(id) } });
      }

      if (request.method === "POST" && action === "restore") {
        const body = await request.json() as { backupId?: string; expectedRevision?: string };
        if (!body.backupId || !/^[a-f0-9]{64}$/.test(body.backupId) || !body.expectedRevision) return json({ error: "invalid_restore" }, 400);
        const current = await readRevision(sandbox);
        if (current !== body.expectedRevision) return json({ error: "revision_conflict", currentRevision: current }, 409);
        const backup = await env.ARTIFACT_BUCKET.get(workspaceBackupKey(body.backupId));
        if (!backup) return json({ error: "backup_not_found" }, 404);
        await sandbox.killAllProcesses();
        const archivePath = `/tmp/${body.backupId}.tar.gz`;
        await sandbox.writeFile(archivePath, backup.body);
        const restored = await sandbox.exec(`rm -rf ${workspaceRoot} && mkdir -p ${workspaceRoot} && tar -xzf ${archivePath} -C ${workspaceRoot} && rm -f ${archivePath} && rm -rf ${workspaceRoot}/node_modules && ln -s /opt/lodesta-site-scaffold/node_modules ${workspaceRoot}/node_modules`, { timeout: 30_000 });
        if (!restored.success) return json({ error: "restore_failed", stderr: restored.stderr.slice(-8_000) }, 422);
        return json({ ok: true, revision: await readRevision(sandbox) });
      }

      if (request.method === "POST" && action === "destroy") {
        await sandbox.destroy();
        return json({ ok: true });
      }

      if (request.method === "GET" && action === "diagnostics") {
        const versions = await sandbox.exec("node --version && npm --version && npm exec --offline tsx -- --version && npm exec --offline vite -- --version", { cwd: workspaceRoot });
        return json({
          ok: versions.success,
          revision: await readRevision(sandbox),
          versions: versions.stdout.trim().split("\n"),
          lodestaVersions: { ...sitePlatformVersionManifest, sourcePolicy: sandboxSourcePolicyVersion },
          placementId: await sandbox.getContainerPlacementId(),
          processes: (await sandbox.listProcesses()).map((process) => ({ id: process.id, command: process.command, status: process.status }))
        });
      }

      return json({ error: "method_not_allowed" }, 405);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
      return json({ error: code ?? "sandbox_operation_failed", detail: error instanceof Error ? error.message : String(error) }, code === "source_policy_violation" ? 422 : 500);
    }
  }
} satisfies ExportedHandler<Env>;

function sandboxFor(env: Env, sessionId: string) {
  return getSandbox(env.Sandbox, sessionId, { normalizeId: true, sleepAfter: "10m", keepAlive: false, enableDefaultSession: true });
}

function authorized(request: Request, env: Env) {
  return Boolean(env.PLATFORM_TOKEN && request.headers.get("authorization") === `Bearer ${env.PLATFORM_TOKEN}`);
}

function validateApply(value: unknown): ApplyRequest {
  if (!value || typeof value !== "object") throw new Error("Apply body must be an object.");
  const record = value as Record<string, unknown>;
  if (typeof record.expectedRevision !== "string" || !record.expectedRevision) throw new Error("expectedRevision is required.");
  if (!Array.isArray(record.files) || record.files.length < 1 || record.files.length > maxFilesPerApply) throw new Error("files has an invalid length.");
  const files = record.files.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Each file must be an object.");
    const file = entry as Record<string, unknown>;
    if (typeof file.path !== "string" || !/^src\/[a-zA-Z0-9_./-]+\.(?:css|ts|tsx|json)$/.test(file.path) || file.path.includes("..")) throw new Error("File path is outside the source allowlist.");
    if (typeof file.content !== "string") throw new Error("File content must be a string.");
    return { path: file.path, content: file.content };
  });
  if (files.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0) > maxApplyBytes) throw new Error("Apply payload is too large.");
  return { expectedRevision: record.expectedRevision, files };
}

function parseSourcePolicyResult(stdout: string) {
  const line = stdout.trim().split("\n").reverse().find((item) => item.trim().startsWith("{"));
  if (!line) return { detail: "Generated source failed the sandbox source policy." };
  try {
    const parsed = JSON.parse(line) as { findings?: unknown };
    return { findings: parsed.findings ?? [] };
  } catch {
    return { detail: "Generated source failed the sandbox source policy." };
  }
}

async function blobRequest(request: Request, bucket: R2Bucket, key: string) {
  if (request.method === "PUT") {
    const expected = request.headers.get("x-lodesta-content-sha256");
    if (!expected || !/^sha256:[a-f0-9]{64}$/.test(expected)) return json({ error: "content_hash_required" }, 400);
    const bytes = await request.arrayBuffer();
    if (`sha256:${await digestBytes(bytes)}` !== expected) return json({ error: "content_hash_mismatch" }, 400);
    const current = await bucket.head(key);
    if (current) return current.customMetadata?.contentHash === expected ? new Response(null, { status: 204 }) : json({ error: "immutable_key_collision" }, 409);
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" },
      customMetadata: { contentHash: expected, createdAt: new Date().toISOString() }
    });
    return new Response(null, { status: 201 });
  }
  const object = request.method === "HEAD" ? await bucket.head(key) : await bucket.get(key);
  if (!object) return new Response(null, { status: 404 });
  const headers = new Headers({
    "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
    "x-lodesta-content-sha256": object.customMetadata?.contentHash ?? "",
    "cache-control": "private, no-store"
  });
  return request.method === "HEAD" ? new Response(null, { headers }) : new Response((object as R2ObjectBody).body, { headers });
}

async function readRevision(sandbox: ReturnType<typeof getSandbox>) {
  const exists = await sandbox.exists(revisionPath);
  return exists.exists ? (await sandbox.readFile(revisionPath, { encoding: "utf8" })).content.trim() : "uninitialized";
}

function decodeBlobKey(value: string) {
  const key = value.split("/").map(decodeURIComponent).join("/");
  if (!key || key.includes("..") || !/^[a-zA-Z0-9_./:-]+$/.test(key)) throw new Error("Invalid blob key.");
  return key;
}

function workspaceBackupKey(id: string) { return `workspace-backups/${id}.tar.gz`; }
async function digest(value: string) { return digestBytes(new TextEncoder().encode(value)); }
async function digestBytes(value: BufferSource) {
  const bytes = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "cache-control": "no-store" } }); }
function applyPreviewHeaders(headers: Headers) {
  headers.set("cache-control", "private, no-store");
  headers.set("content-security-policy", "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
}
