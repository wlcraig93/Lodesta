import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Sandbox, SandboxNotFoundError, type ExecResult, type SandboxTemplate } from "railway";
import { sha256 } from "@/packages/business-data";
import { expectedSiteSandboxManifest, sitePublicBuildInputSchema, type SitePublicBuildInput } from "@/packages/site-contracts";
import { agentAuthoredArtifactSchema, normalizeAgentAuthoredArtifact, type AgentAuthoredArtifact } from "@/packages/site-verification";
import { assertWorkspaceSourcePolicy } from "@/packages/site-agent/source-policy";
import type { ArtifactBlobStore } from "@/packages/site-artifacts";
import { requiredDestinationsSource } from "../../workers/site-sandbox/src/initial-source";
import {
  SiteSandboxArtifactContractError,
  SiteSandboxRequestError,
  type AuthoringSandbox,
  type SandboxBuildSuccess,
  type SandboxDiagnostics,
  type WorkspaceSourceFile
} from "./client";

const workspaceRoot = "/workspace";
const idleTimeoutMinutes = 20;
const liveSandboxes = new Map<string, Sandbox>();
const operationTails = new Map<string, Promise<unknown>>();

let scaffoldArchivePromise: Promise<Uint8Array> | undefined;
let dependencyTemplatePromise: Promise<SandboxTemplate | undefined> | undefined;

export function isRailwaySandboxId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function configuredRailwayAuthoringSandbox(blobStore: ArtifactBlobStore) {
  return new RailwaySiteSandbox(blobStore);
}

export class RailwaySiteSandbox implements AuthoringSandbox {
  constructor(private readonly blobStore: ArtifactBlobStore) {}

  async provision() {
    const startedAt = Date.now();
    const template = await dependencyTemplate();
    const options = { ...railwayConnection(), idleTimeoutMinutes, networkIsolation: "ISOLATED" as const };
    const sandbox = template ? await Sandbox.create(template, options) : await Sandbox.create(options);
    try {
      await waitUntilRunning(sandbox);
    } catch (error) {
      await sandbox.destroy().catch(() => undefined);
      throw error;
    }
    liveSandboxes.set(sandbox.id, sandbox);
    logSandboxTiming(sandbox.id, "provision", startedAt, { fromTemplate: Boolean(template) });
    return sandbox.id;
  }

  async bootstrap(sessionId: string, buildInput: SitePublicBuildInput) {
    return this.exclusive(sessionId, async (sandbox) => {
      const startedAt = Date.now();
      const steps: Record<string, number> = {};
      const step = async <T>(name: string, operation: () => Promise<T>) => {
        const stepStartedAt = Date.now();
        try {
          return await operation();
        } finally {
          steps[name] = Date.now() - stepStartedAt;
        }
      };
      try {
        const parsed = sitePublicBuildInputSchema.parse(buildInput);
        await step("toolchain", () => this.ensureToolchain(sandbox));
        const publicInputJson = await step("publicInput", () => writePublicInput(sandbox, parsed));
        await step("requiredDestinations", () => sandbox.files.write(`${workspaceRoot}/src/required-destinations.tsx`, requiredDestinationsSource(parsed)));
        const files = await step("readSource", () => readSourceFiles(sandbox));
        const revision = await step("revision", () => writeRevision(sandbox, files, publicInputJson));
        logSandboxTiming(sandbox.id, "bootstrap", startedAt, { steps });
        return { ok: true as const, revision };
      } catch (error) {
        logSandboxTiming(sandbox.id, "bootstrap_failed", startedAt, { steps, error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
        throw error;
      }
    });
  }

  async apply(sessionId: string, expectedRevision: string, files: WorkspaceSourceFile[]) {
    assertWorkspaceSourcePolicy(files);
    return this.exclusive(sessionId, async (sandbox) => {
      await this.requireRevision(sandbox, sessionId, expectedRevision);
      return this.compile(sandbox, sessionId, files);
    });
  }

  async rebase(sessionId: string, expectedRevision: string, buildInput: SitePublicBuildInput) {
    const parsed = sitePublicBuildInputSchema.parse(buildInput);
    return this.exclusive(sessionId, async (sandbox) => {
      await this.requireRevision(sandbox, sessionId, expectedRevision);
      const publicInputJson = await writePublicInput(sandbox, parsed);
      const files = await readSourceFiles(sandbox);
      return this.compile(sandbox, sessionId, files, publicInputJson);
    });
  }

  async getArtifact(sessionId: string): Promise<AgentAuthoredArtifact> {
    return this.exclusive(sessionId, async (sandbox) => {
      const exists = await sandbox.files.exists(`${workspaceRoot}/dist/lodesta-artifact.json`);
      if (!exists) throw requestError(sessionId, "artifact", 404, "artifact_not_built", "Sandbox artifact has not been built.");
      const artifact = JSON.parse(await sandbox.files.read(`${workspaceRoot}/dist/lodesta-artifact.json`));
      const parsed = agentAuthoredArtifactSchema.safeParse(normalizeAgentAuthoredArtifact(artifact));
      if (!parsed.success) {
        throw new SiteSandboxArtifactContractError(parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "artifact"}: ${issue.message}`)
          .join("; ")
          .slice(0, 4000));
      }
      return parsed.data;
    });
  }

  async getSource(sessionId: string) {
    return this.exclusive(sessionId, async (sandbox) => ({
      ok: true as const,
      revision: (await readRevision(sandbox)).trim() || "uninitialized",
      files: await readSourceFiles(sandbox)
    }));
  }

  async backup(sessionId: string) {
    return this.exclusive(sessionId, async (sandbox) => {
      const revision = (await readRevision(sandbox)).trim();
      if (!revision || revision === "uninitialized") {
        throw requestError(sessionId, "backup", 409, "workspace_uninitialized", "Sandbox workspace has not been bootstrapped.");
      }
      const archived = await exec(sandbox, `tar --exclude=node_modules --exclude=dist -czf /tmp/lodesta-backup.tar.gz -C ${workspaceRoot} .`, 30);
      if (archived.exitCode !== 0) throw requestError(sessionId, "backup", 422, "backup_failed", commandOutput(archived));
      const bytes = Buffer.from(await sandbox.files.read("/tmp/lodesta-backup.tar.gz", { format: "bytes" }));
      const contentHash = sha256(bytes);
      const id = contentHash.slice("sha256:".length);
      const key = `workspace-backups/${id}.tar.gz`;
      await this.blobStore.putImmutable({
        key,
        bytes,
        contentType: "application/gzip",
        contentHash
      });
      const verified = await this.blobStore.get(key);
      if (!verified || verified.contentHash !== contentHash || verified.bytes.length !== bytes.length) {
        throw requestError(sessionId, "backup", 500, "backup_verification_failed", "Workspace backup could not be read back.");
      }
      return { ok: true as const, backup: { id, revision, size: bytes.length, key, contentHash } };
    });
  }

  async restore(sessionId: string, backupId: string, expectedRevision: string, expectedArchiveHash: `sha256:${string}`) {
    if (!/^[a-f0-9]{64}$/.test(backupId)) throw requestError(sessionId, "restore", 422, "restore_failed", "Backup id is invalid.");
    return this.exclusive(sessionId, async (sandbox) => {
      await this.requireRevision(sandbox, sessionId, expectedRevision);
      const key = `workspace-backups/${backupId}.tar.gz`;
      const blob = await this.blobStore.get(key);
      if (!blob) return this.compile(sandbox, sessionId, await sourceFilesFromSidecar(this.blobStore, backupId, expectedArchiveHash));
      if (blob.contentHash !== expectedArchiveHash) {
        throw requestError(sessionId, "restore", 422, "restore_failed", "Workspace backup is missing or does not match its archive hash.");
      }
      await sandbox.files.write("/tmp/lodesta-restore.tar.gz", blob.bytes);
      const extracted = await exec(sandbox, [
        "rm -rf /tmp/lodesta-restore",
        "mkdir -p /tmp/lodesta-restore",
        "tar -xzf /tmp/lodesta-restore.tar.gz -C /tmp/lodesta-restore",
        "test -d /tmp/lodesta-restore/src"
      ].join(" && "), 30);
      if (extracted.exitCode !== 0) throw requestError(sessionId, "restore", 422, "restore_failed", commandOutput(extracted));
      if (await sandbox.files.exists("/tmp/lodesta-restore/public-build-input.json")) {
        const json = await sandbox.files.read("/tmp/lodesta-restore/public-build-input.json");
        await sandbox.files.write(`${workspaceRoot}/public-build-input.json`, json);
        await sandbox.files.write(`${workspaceRoot}/.lodesta/public-build-input.json`, json);
      }
      const files = await readSourceFiles(sandbox, "/tmp/lodesta-restore");
      return this.compile(sandbox, sessionId, files);
    });
  }

  async diagnostics(sessionId: string, _timeoutMs?: number): Promise<SandboxDiagnostics> {
    return this.exclusive(sessionId, async (sandbox) => {
      const revision = (await readRevision(sandbox).catch(() => "uninitialized")).trim() || "uninitialized";
      const versions = await exec(sandbox, "node --version && npm --version", 15);
      return {
        ok: revision !== "uninitialized" && versions.exitCode === 0,
        revision,
        versions: versions.stdout.trim().split("\n").filter(Boolean),
        sandboxManifest: { ...expectedSiteSandboxManifest },
        placementId: sandbox.id,
        processes: []
      };
    });
  }

  async destroy(sessionId: string) {
    const cached = liveSandboxes.get(sessionId);
    liveSandboxes.delete(sessionId);
    try {
      const sandbox = cached ?? await Sandbox.connect(sessionId, railwayConnection());
      await sandbox.destroy();
    } catch (error) {
      if (error instanceof SandboxNotFoundError || /not found|already destroyed/i.test(error instanceof Error ? error.message : "")) {
        throw requestError(sessionId, "destroy", 404, "sandbox_not_found", "Railway sandbox is already gone.");
      }
      throw error;
    }
    return { ok: true as const };
  }

  async fetchPreview(sessionId: string, route = "/") {
    const path = previewPath(route);
    return this.exclusive(sessionId, async (sandbox) => {
      const filePath = await previewFile(sandbox, path);
      if (!filePath) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
      const bytes = Buffer.from(await sandbox.files.read(filePath, { format: "bytes" }));
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": previewContentType(filePath), "cache-control": "no-store" }
      });
    });
  }

  private async compile(
    sandbox: Sandbox,
    sessionId: string,
    files: WorkspaceSourceFile[],
    publicInputJson?: string
  ): Promise<SandboxBuildSuccess> {
    const startedAt = Date.now();
    const canonical = canonicalFiles(files);
    assertWorkspaceSourcePolicy(canonical);
    const previous = await exec(sandbox, `rm -rf /tmp/lodesta-src-prev && cp -a ${workspaceRoot}/src /tmp/lodesta-src-prev`, 20);
    if (previous.exitCode !== 0) throw requestError(sessionId, "apply", 500, "candidate_promotion_failed", commandOutput(previous));
    try {
      await replaceSource(sandbox, canonical);
      const inputJson = publicInputJson ?? await sandbox.files.read(`${workspaceRoot}/.lodesta/public-build-input.json`);
      const runtimeSeriesId = runtimeSeries(inputJson);
      await sandbox.files.write(`${workspaceRoot}/source-policy-input.json`, JSON.stringify({ files: canonical, runtimeSeriesId }));
      const validatedAt = Date.now();
      const validated = await exec(sandbox, `cd ${workspaceRoot} && npm run validate-source -- source-policy-input.json`, 60);
      if (validated.exitCode !== 0) {
        throw requestError(sessionId, "apply", 422, validated.exitCode === 2 ? "source_policy_violation" : "build_failed", commandOutput(validated));
      }
      const builtAt = Date.now();
      const built = await exec(sandbox, `cd ${workspaceRoot} && npm run build`, 150);
      if (built.timedOut) throw requestError(sessionId, "apply", 408, "build_timeout", commandOutput(built));
      if (built.exitCode !== 0) throw requestError(sessionId, "apply", 422, "build_failed", commandOutput(built));
      const revision = await writeRevision(sandbox, canonical, inputJson);
      const success: SandboxBuildSuccess = {
        ok: true,
        revision,
        previewUrl: "http://127.0.0.1:4173/",
        buildDurationMs: Date.now() - startedAt,
        placementId: sandbox.id,
        operationId: sha256(`${sessionId}:${revision}`).slice("sha256:".length),
        activeGenerationRevision: revision,
        phaseTimings: {
          validate: builtAt - validatedAt,
          build: Date.now() - builtAt
        }
      };
      return success;
    } catch (error) {
      await exec(sandbox, `rm -rf ${workspaceRoot}/src && cp -a /tmp/lodesta-src-prev ${workspaceRoot}/src`, 20).catch(() => undefined);
      throw error;
    }
  }

  private async ensureToolchain(sandbox: Sandbox) {
    // Sandboxes from the dependency template already hold node_modules; the
    // scaffold source is still extracted from this deployment's archive.
    if (!await retryTransport(() => sandbox.files.exists(`${workspaceRoot}/platform/build.tsx`))) {
      const archive = await scaffoldArchive();
      await sandbox.files.write("/tmp/lodesta-scaffold.tgz", archive);
      const extracted = await exec(sandbox, `mkdir -p ${workspaceRoot} && tar -xzf /tmp/lodesta-scaffold.tgz -C ${workspaceRoot} && test -f ${workspaceRoot}/package-lock.json`, 30);
      if (extracted.exitCode !== 0) throw requestError(sandbox.id, "bootstrap", 500, "candidate_promotion_failed", commandOutput(extracted));
    }
    if (await retryTransport(() => sandbox.files.exists(`${workspaceRoot}/node_modules/vite`))) return;
    const installed = await exec(sandbox, `cd ${workspaceRoot} && npm ci --ignore-scripts --no-audit --no-fund`, 180);
    if (installed.exitCode !== 0) throw requestError(sandbox.id, "bootstrap", 500, "candidate_promotion_failed", commandOutput(installed));
  }

  private async requireRevision(sandbox: Sandbox, sessionId: string, expectedRevision: string) {
    const current = (await readRevision(sandbox)).trim();
    if (!current || current === "uninitialized") {
      throw requestError(sessionId, "apply", 409, "workspace_uninitialized", "currentRevision=uninitialized");
    }
    if (current !== expectedRevision) {
      throw requestError(sessionId, "apply", 409, "revision_conflict", `currentRevision=${current}`);
    }
  }

  private async exclusive<T>(sessionId: string, operation: (sandbox: Sandbox) => Promise<T>) {
    const previous = operationTails.get(sessionId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => operation(await openSandbox(sessionId)));
    operationTails.set(sessionId, run);
    try {
      return await run;
    } finally {
      if (operationTails.get(sessionId) === run) operationTails.delete(sessionId);
    }
  }
}

function railwayConnection() {
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID || linkedEnvironmentId();
  if (!environmentId) throw new Error("Railway sandbox environment is not configured.");
  const apiToken = process.env.RAILWAY_API_TOKEN;
  if (apiToken) return { token: apiToken, authType: "bearer" as const, environmentId };
  const projectToken = process.env.RAILWAY_TOKEN;
  if (projectToken) return { token: projectToken, authType: "project-token" as const, environmentId };
  const token = cliAccessToken();
  if (!token) throw new Error("Railway sandbox token is not configured.");
  return { token, authType: "bearer" as const, environmentId };
}

function linkedEnvironmentId() {
  const projects = railwayConfig()?.projects;
  if (!projects || typeof projects !== "object") return undefined;
  const linked = (projects as Record<string, { environment?: unknown }>)[process.cwd()];
  return typeof linked?.environment === "string" ? linked.environment : undefined;
}

function cliAccessToken() {
  const user = railwayConfig()?.user as { accessToken?: unknown } | undefined;
  return typeof user?.accessToken === "string" && user.accessToken ? user.accessToken : undefined;
}

function railwayConfig() {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".railway", "config.json"), "utf8")) as { user?: unknown; projects?: unknown };
  } catch {
    return undefined;
  }
}

async function openSandbox(sessionId: string) {
  if (!isRailwaySandboxId(sessionId)) throw requestError(sessionId, "connect", 404, "sandbox_not_found", "Sandbox id is not a Railway sandbox.");
  const cached = liveSandboxes.get(sessionId);
  if (cached && cached.status !== "DESTROYED" && cached.status !== "DESTROYING" && cached.status !== "FAILED") return cached;
  try {
    const sandbox = await Sandbox.connect(sessionId, railwayConnection());
    await waitUntilRunning(sandbox);
    liveSandboxes.set(sessionId, sandbox);
    return sandbox;
  } catch (error) {
    if (error instanceof SandboxNotFoundError) throw requestError(sessionId, "connect", 404, "sandbox_not_found", "Railway sandbox is already gone.");
    throw error;
  }
}

async function waitUntilRunning(sandbox: Sandbox) {
  const deadline = Date.now() + 60_000;
  while (sandbox.status !== "RUNNING") {
    if (sandbox.status === "FAILED" || sandbox.status === "DESTROYED" || sandbox.status === "DESTROYING") {
      throw requestError(sandbox.id, "provision", 500, "sandbox_operation_failed", `Railway sandbox is ${sandbox.status}.`);
    }
    if (Date.now() > deadline) throw requestError(sandbox.id, "provision", 408, "build_timeout", "Railway sandbox did not become ready.");
    await wait(500);
    await sandbox.refresh();
  }
}

async function writePublicInput(sandbox: Sandbox, input: SitePublicBuildInput) {
  const json = `${JSON.stringify(input)}\n`;
  await retryTransport(() => sandbox.files.mkdir(`${workspaceRoot}/.lodesta`));
  await sandbox.files.write(`${workspaceRoot}/public-build-input.json`, json);
  await sandbox.files.write(`${workspaceRoot}/.lodesta/public-build-input.json`, json);
  return json;
}

async function writeRevision(sandbox: Sandbox, files: WorkspaceSourceFile[], publicInputJson: string) {
  const revision = sha256(JSON.stringify({
    files: canonicalFiles(files).map((file) => [file.path, file.content]),
    publicInputJson
  })).slice("sha256:".length);
  await retryTransport(() => sandbox.files.mkdir(`${workspaceRoot}/.lodesta`));
  await sandbox.files.write(`${workspaceRoot}/.lodesta/revision`, revision);
  return revision;
}

async function readRevision(sandbox: Sandbox) {
  if (!await retryTransport(() => sandbox.files.exists(`${workspaceRoot}/.lodesta/revision`))) return "uninitialized";
  return sandbox.files.read(`${workspaceRoot}/.lodesta/revision`);
}

async function readSourceFiles(sandbox: Sandbox, root = workspaceRoot) {
  const listed = await exec(sandbox, `find ${root}/src -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \\) ! -name '._*' -print | sort`, 20);
  if (listed.exitCode !== 0) throw requestError(sandbox.id, "source", 404, "source_unavailable", commandOutput(listed));
  const files: WorkspaceSourceFile[] = [];
  for (const absolutePath of listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean)) {
    if (!absolutePath.startsWith(`${root}/src/`) || absolutePath.includes("..")) {
      throw requestError(sandbox.id, "source", 500, "source_path_violation", absolutePath);
    }
    files.push({ path: absolutePath.slice(`${root}/`.length), content: await sandbox.files.read(absolutePath) });
  }
  return canonicalFiles(files);
}

async function replaceSource(sandbox: Sandbox, files: WorkspaceSourceFile[]) {
  const cleared = await exec(sandbox, `rm -rf ${workspaceRoot}/src && mkdir -p ${workspaceRoot}/src`, 20);
  if (cleared.exitCode !== 0) throw requestError(sandbox.id, "apply", 500, "candidate_promotion_failed", commandOutput(cleared));
  for (const file of files) {
    if (!file.path.startsWith("src/") || file.path.includes("..")) {
      throw requestError(sandbox.id, "apply", 422, "source_policy_violation", file.path);
    }
    await sandbox.files.write(`${workspaceRoot}/${file.path}`, file.content);
  }
}

async function exec(sandbox: Sandbox, script: string, timeoutSec: number) {
  let last: ExecResult | undefined;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const scriptPath = `/tmp/lodesta-${randomUUID()}.sh`;
    try {
      await sandbox.files.write(scriptPath, script);
      last = await sandbox.exec(`bash ${scriptPath}`, { timeoutSec, cwd: "/" });
    } catch (error) {
      if (!shellIsStarting(error) || attempt === 7) throw error;
      await wait(500);
      continue;
    }
    if (last.exitCode === 0 || !shellIsStarting(last) || attempt === 7) return last;
    await wait(500);
  }
  return last!;
}

function shellIsStarting(value: unknown) {
  const text = value instanceof Error
    ? value.message
    : `${(value as ExecResult).stderr ?? ""}\n${(value as ExecResult).stdout ?? ""}`;
  return /starting your shell session|sandbox is not running|CREATING/i.test(text);
}

/**
 * A Railway template with this deployment's scaffold dependencies installed.
 * Railway caches built templates by recipe, so rebuilding an unchanged
 * recipe is a lookup; a changed lockfile builds a new template. When the
 * template cannot be built, sandboxes start plain and bootstrap installs.
 */
function dependencyTemplate() {
  dependencyTemplatePromise ??= buildDependencyTemplate().catch((error) => {
    dependencyTemplatePromise = undefined;
    console.error(JSON.stringify({ event: "sandbox_template_unavailable", error: error instanceof Error ? error.message.slice(0, 300) : String(error) }));
    return undefined;
  });
  return dependencyTemplatePromise;
}

async function buildDependencyTemplate() {
  const scaffold = join(process.cwd(), "workers/site-sandbox/scaffold");
  let template = Sandbox.template().run(`mkdir -p ${workspaceRoot}`).workdir(workspaceRoot);
  for (const name of ["package.json", "package-lock.json"]) {
    for (const command of writeFileSteps(`${workspaceRoot}/${name}`, readFileSync(join(scaffold, name)))) template = template.run(command);
  }
  template = template.run(`cd ${workspaceRoot} && npm ci --ignore-scripts --no-audit --no-fund && test -d node_modules/vite`);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      template.build(railwayConnection()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Railway dependency template build timed out.")), 300_000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Shell steps that recreate a file byte for byte (template recipes carry no file uploads). */
export function writeFileSteps(path: string, bytes: Buffer) {
  const chunks = bytes.toString("base64").match(/.{1,12000}/g) ?? [""];
  return [
    ...chunks.map((chunk, index) => `printf '%s' '${chunk}' ${index ? ">>" : ">"} ${path}.b64`),
    `base64 -d < ${path}.b64 > ${path} && rm ${path}.b64`
  ];
}

/** File operations the SDK does not retry itself get one retry after a dropped connection. */
async function retryTransport<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (!/websocket|connection|econnreset|socket hang up|timed? ?out/i.test(error instanceof Error ? error.message : String(error))) throw error;
    await wait(500);
    return operation();
  }
}

function logSandboxTiming(sandboxId: string, phase: string, startedAt: number, detail: Record<string, unknown>) {
  console.log(JSON.stringify({ event: "sandbox_timing", sandboxId, phase, durationMs: Date.now() - startedAt, ...detail }));
}

function scaffoldArchive() {
  scaffoldArchivePromise ??= createScaffoldArchive().catch((error) => {
    scaffoldArchivePromise = undefined;
    throw error;
  });
  return scaffoldArchivePromise;
}

function createScaffoldArchive() {
  const scaffold = join(process.cwd(), "workers/site-sandbox/scaffold");
  return new Promise<Uint8Array>((resolve, reject) => {
    const child = spawn("tar", ["-czf", "-", "-C", scaffold, "--exclude", "node_modules", "--exclude", "dist", "."], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, COPYFILE_DISABLE: "1" }
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Scaffold archive failed (${code}): ${Buffer.concat(stderr).toString("utf8").slice(-1000)}`));
        return;
      }
      resolve(Buffer.concat(stdout));
    });
  });
}

async function sourceFilesFromSidecar(blobStore: ArtifactBlobStore, backupId: string, expectedArchiveHash: string) {
  const sidecarBlob = await blobStore.get(`workspace-sources/${backupId}.json`);
  if (!sidecarBlob) {
    throw requestError(backupId, "restore", 422, "restore_failed", "Workspace backup is missing or does not match its archive hash.");
  }
  const sidecar = JSON.parse(sidecarBlob.bytes.toString("utf8")) as {
    backupId?: string;
    archiveHash?: string;
    files?: Array<{ path?: string; content?: string }>;
  };
  const files = (sidecar.files ?? []).flatMap((file) => (
    typeof file.path === "string" && typeof file.content === "string" ? [{ path: file.path, content: file.content }] : []
  ));
  if (sidecar.backupId !== backupId || sidecar.archiveHash !== expectedArchiveHash || files.length === 0) {
    throw requestError(backupId, "restore", 422, "restore_failed", "Workspace backup is missing or does not match its archive hash.");
  }
  return files;
}

function canonicalFiles(files: WorkspaceSourceFile[]) {
  return files
    .filter((file) => !file.path.split("/").some((segment) => segment.startsWith("._")))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function runtimeSeries(publicInputJson: string) {
  const parsed = JSON.parse(publicInputJson) as { capabilityConfiguration?: { trustedRuntimeSeries?: unknown } };
  const series = parsed.capabilityConfiguration?.trustedRuntimeSeries;
  return typeof series === "string" ? series : undefined;
}

function previewPath(route: string) {
  const path = route.startsWith("/") ? route : `/${route}`;
  if (path.includes("..") || !/^\/[A-Za-z0-9._~/-]*$/.test(path)) throw new Error("Preview route is invalid.");
  return path;
}

async function previewFile(sandbox: Sandbox, route: string) {
  const relative = route.replace(/^\/+/, "");
  const exact = relative ? `${workspaceRoot}/dist/${relative}` : "";
  if (exact && await sandbox.files.exists(exact) && !exact.endsWith("/")) {
    const stat = await sandbox.files.stat(exact).catch(() => undefined);
    if (stat && !stat.isDir) return exact;
  }
  const index = `${workspaceRoot}/dist/${relative ? `${relative.replace(/\/+$/, "")}/` : ""}index.html`;
  if (await sandbox.files.exists(index)) return index;
  if (!relative.includes(".")) {
    const home = `${workspaceRoot}/dist/index.html`;
    if (await sandbox.files.exists(home)) return home;
  }
  return undefined;
}

function previewContentType(filePath: string) {
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  };
  return types[extension] ?? "application/octet-stream";
}

function requestError(sessionId: string, action: string, status: number, providerCode: string, diagnostics: string) {
  return new SiteSandboxRequestError(action, sessionId, status, providerCode, diagnostics.slice(-4000));
}

function commandOutput(result: ExecResult) {
  return `${result.stderr}\n${result.stdout}`.trim().slice(-4000);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
