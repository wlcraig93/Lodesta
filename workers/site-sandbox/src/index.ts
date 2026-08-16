/// <reference types="@cloudflare/workers-types" />

import {
  ContainerProxy,
  getSandbox,
  Sandbox as CloudflareSandbox,
  type Sandbox as SandboxDurableObject
} from "@cloudflare/sandbox";
import {
  sandboxApiIdentity,
  sandboxDurableObjectIdentity,
  sandboxStorageIdentity,
  sandboxArtifactContractIdentity,
  sandboxSourcePolicyIdentity,
  sandboxToolchainIdentity
} from "../scaffold/component-manifest";
import { promoteGenerationTransaction } from "./generation-transaction";
export { ContainerProxy };

export class Sandbox extends CloudflareSandbox {
  enableInternet = false;
}

interface Env {
  Sandbox: DurableObjectNamespace<SandboxDurableObject>;
  WORKSPACE_BUCKET: R2Bucket;
  SANDBOX_TRANSPORT: "rpc";
  SANDBOX_TOKEN?: string;
}

type ApplyRequest = {
  expectedRevision: string;
  files: Array<{ path: string; content: string }>;
};

type GenerationStatus = "initialized" | "built";
type GenerationMetadata = {
  schemaVersion: 1;
  revision: string;
  sourceHash: string;
  publicInputHash: string;
  operationId: string;
  payloadHash: string;
  status: GenerationStatus;
  createdAt: string;
  result?: BuildSuccess;
};
type BuildSuccess = {
  ok: true;
  revision: string;
  previewUrl: string;
  buildDurationMs: number;
  placementId: string;
  operationId: string;
  activeGenerationRevision: string;
  replayed?: boolean;
  phaseTimings: Record<string, number>;
  warnings?: string[];
};
type GenerationAction = "apply" | "rebase" | "restore";
type GenerationRequest = {
  action: GenerationAction;
  expectedRevision: string;
  files: Array<{ path: string; content: string }>;
  publicInputJson: string;
  extraPayload?: Record<string, unknown>;
};
type OperationPhase = "queued" | "preparing" | "validating" | "compiling" | "promoting" | "complete";
type OperationFailure = {
  status: number;
  payload: Record<string, unknown>;
};
type OperationJournal = {
  schemaVersion: 1;
  operationId: string;
  payloadHash: string;
  status: "queued" | "running" | "succeeded" | "failed";
  phase: OperationPhase;
  createdAt: string;
  updatedAt: string;
  phaseStartedAt: string;
  timestamps: Partial<Record<OperationPhase, string>>;
  phaseTimings: Record<string, number>;
  candidateRevision?: string;
  processId?: string;
  result?: BuildSuccess;
  failure?: OperationFailure;
  completedAt?: string;
  submissionReplayed?: boolean;
};

const sessionRoot = "/workspace/site";
const generationsRoot = `${sessionRoot}/generations`;
const operationsRoot = `${sessionRoot}/operations`;
const activeLink = `${sessionRoot}/active`;
const nextActiveLink = `${sessionRoot}/active.next`;
const mutationLock = `${sessionRoot}/mutation.lock`;
const cleanupPendingPath = `${operationsRoot}/cleanup-pending.json`;
const operationRequestSuffix = ".request.json";
const operationValidationSuffix = ".source-policy-passed";
const workspaceRoot = activeLink;
const revisionPath = `${workspaceRoot}/.lodesta/revision`;
const publicInputPath = `${workspaceRoot}/public-build-input.json`;
const previewPort = 4173;
const maxFilesPerApply = 80;
const maxApplyBytes = 4_000_000;
const operationStaleAfterMs = 4 * 60_000;
const previewStarts = new Map<string, Promise<void>>();
const sandboxManifest = {
  kind: "site-sandbox-manifest",
  apiIdentity: sandboxApiIdentity,
  storageIdentity: sandboxStorageIdentity,
  durableObjectIdentity: sandboxDurableObjectIdentity,
  artifactContractIdentity: sandboxArtifactContractIdentity,
  toolchainIdentity: sandboxToolchainIdentity,
  sourcePolicyIdentity: sandboxSourcePolicyIdentity
} as const;

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({
        ok: true,
        provider: "cloudflare-sandbox",
        transport: env.SANDBOX_TRANSPORT,
        sandboxManifest
      });
    }
    if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);

    const previewMatch = url.pathname.match(/^\/v1\/sessions\/([a-z0-9_-]{1,80})\/preview(\/.*)?$/);
    if (request.method === "GET" && previewMatch) {
      const sandbox = sandboxFor(env, previewMatch[1]);
      const built = await sandbox.exists(`${workspaceRoot}/dist/index.html`);
      if (!built.exists) return json({ error: "preview_not_ready" }, 409);
      try {
        await ensurePreviewServer(previewMatch[1], sandbox);
      } catch (error) {
        return json({ error: "preview_expired", detail: error instanceof Error ? error.message : String(error) }, 409);
      }
      const upstream = new URL(request.url);
      upstream.pathname = previewMatch[2] || "/";
      const response = await sandbox.containerFetch(new Request(upstream, request), previewPort);
      const headers = new Headers(response.headers);
      applyPreviewHeaders(headers);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    const operationMatch = url.pathname.match(/^\/v1\/sessions\/([a-z0-9_-]{1,80})\/operations\/([a-f0-9]{64})$/);
    if (request.method === "GET" && operationMatch) {
      const sessionId = operationMatch[1];
      const sandbox = sandboxFor(env, sessionId);
      try {
        const status = await operationStatus(
          sandbox,
          sessionId,
          url.origin,
          operationMatch[2],
          (work) => context.waitUntil(work.catch(() => undefined))
        );
        return json(status);
      } catch (error) {
        if (error instanceof SandboxOperationError) return json(error.payload, error.status);
        return json({ error: "sandbox_operation_failed", detail: error instanceof Error ? error.message : String(error) }, 500);
      }
    }

    const match = url.pathname.match(/^\/v1\/sessions\/([a-z0-9_-]{1,80})\/(bootstrap|apply|rebase|artifact|source|backup|restore|destroy|diagnostics)$/);
    if (!match) return json({ error: "not_found" }, 404);
    const sessionId = match[1];
    const action = match[2];
    const sandbox = sandboxFor(env, sessionId);

    try {
      if (request.method === "POST" && action === "bootstrap") {
        const body = await request.json() as { publicBuildInput?: unknown };
        if (!body.publicBuildInput || typeof body.publicBuildInput !== "object") return json({ error: "public_build_input_required" }, 400);
        const revision = await bootstrapWorkspace(sandbox, sessionId, body.publicBuildInput);
        return json({ ok: true, revision });
      }

      if (request.method === "POST" && action === "apply") {
        const body = validateApply(await request.json());
        const accepted = await applyGeneration(sandbox, sessionId, body);
        if (accepted.status === "succeeded") return json(accepted.result);
        context.waitUntil(startQueuedOperation(sandbox, sessionId, url.origin, accepted.operationId).catch(() => undefined));
        return json(publicOperationStatus(accepted), 202);
      }

      if (request.method === "POST" && action === "rebase") {
        const body = await request.json() as { expectedRevision?: unknown; publicBuildInput?: unknown };
        if (typeof body.expectedRevision !== "string" || !body.publicBuildInput || typeof body.publicBuildInput !== "object") {
          return json({ error: "invalid_rebase_request" }, 400);
        }
        const accepted = await rebaseGeneration(sandbox, sessionId, {
          expectedRevision: body.expectedRevision,
          publicBuildInput: body.publicBuildInput
        });
        if (accepted.status === "succeeded") return json(accepted.result);
        context.waitUntil(startQueuedOperation(sandbox, sessionId, url.origin, accepted.operationId).catch(() => undefined));
        return json(publicOperationStatus(accepted), 202);
      }

      if (request.method === "GET" && action === "artifact") {
        const exists = await sandbox.exists(`${workspaceRoot}/dist/lodesta-artifact.json`);
        if (!exists.exists) return json({ error: "artifact_not_built" }, 404);
        const file = await sandbox.readFile(`${workspaceRoot}/dist/lodesta-artifact.json`, { encoding: "utf8" });
        if (file.content.length > 4_000_000) return json({ error: "artifact_too_large" }, 413);
        return new Response(file.content, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      }

      if (request.method === "GET" && action === "source") {
        const listed = await sandbox.exec(`find ${workspaceRoot}/src -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \\) -print | sort`);
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
        const archiveBytes = await new Response(archive.content).arrayBuffer();
        const archiveHash = `sha256:${await digestBytes(archiveBytes)}` as const;
        await env.WORKSPACE_BUCKET.put(workspaceBackupKey(id), archiveBytes, {
          httpMetadata: { contentType: "application/gzip" },
          customMetadata: { sessionId, revision, archiveHash, createdAt: new Date().toISOString() }
        });
        const verified = await env.WORKSPACE_BUCKET.get(workspaceBackupKey(id));
        if (!verified || verified.size !== archive.size || verified.customMetadata?.archiveHash !== archiveHash) {
          return json({ error: "backup_verification_failed" }, 500);
        }
        const verifiedBytes = await verified.arrayBuffer();
        if (`sha256:${await digestBytes(verifiedBytes)}` !== archiveHash) {
          return json({ error: "backup_verification_failed" }, 500);
        }
        await sandbox.deleteFile(archivePath);
        return json({ ok: true, backup: { id, revision, size: archive.size, key: workspaceBackupKey(id), contentHash: archiveHash } });
      }

      if (request.method === "POST" && action === "restore") {
        const body = await request.json() as { backupId?: string; expectedRevision?: string; expectedArchiveHash?: string };
        if (!body.backupId || !/^[a-f0-9]{64}$/.test(body.backupId) || !body.expectedRevision || !body.expectedArchiveHash
          || !/^sha256:[a-f0-9]{64}$/.test(body.expectedArchiveHash)) return json({ error: "invalid_restore" }, 400);
        const backup = await env.WORKSPACE_BUCKET.get(workspaceBackupKey(body.backupId));
        if (!backup) return json({ error: "backup_not_found" }, 404);
        const archiveBytes = await backup.arrayBuffer();
        const actualArchiveHash = `sha256:${await digestBytes(archiveBytes)}`;
        const metadataArchiveHash = backup.customMetadata?.archiveHash ?? backup.customMetadata?.archivehash;
        if (metadataArchiveHash !== body.expectedArchiveHash || actualArchiveHash !== body.expectedArchiveHash) {
          return json({ error: "backup_hash_mismatch" }, 409);
        }
        const accepted = await restoreGeneration(sandbox, sessionId, {
          backupId: body.backupId,
          expectedRevision: body.expectedRevision,
          expectedArchiveHash: body.expectedArchiveHash,
          archiveBytes
        });
        if (accepted.status === "succeeded") return json(accepted.result);
        context.waitUntil(startQueuedOperation(sandbox, sessionId, url.origin, accepted.operationId).catch(() => undefined));
        return json(publicOperationStatus(accepted), 202);
      }

      if (request.method === "POST" && action === "destroy") {
        await sandbox.destroy();
        return json({ ok: true });
      }

      if (request.method === "GET" && action === "diagnostics") {
        const versions = await sandbox.exec("node --version && npm --version && npm exec --offline tsx -- --version && npm exec --offline vite -- --version", { cwd: workspaceRoot });
        const manifestFile = await sandbox.readFile("/opt/lodesta-site-scaffold/lodesta-manifest.json", { encoding: "utf8" });
        const sandboxManifest = JSON.parse(manifestFile.content);
        const generation = await readActiveGeneration(sandbox);
        const pointer = await sandbox.exec(`readlink ${activeLink}`);
        const lock = await readJson<{ operationId?: string; startedAt?: string }>(sandbox, `${mutationLock}/lock.json`).catch(() => undefined);
        const activeOperation = lock?.operationId && /^[a-f0-9]{64}$/.test(lock.operationId)
          ? await readOperationJournal(sandbox, lock.operationId).catch(() => undefined)
          : undefined;
        return json({
          ok: versions.success,
          revision: generation.revision,
          activeGeneration: generation,
          activeGenerationTarget: pointer.success ? pointer.stdout.trim() : undefined,
          mutationLock: lock,
          activeOperation: activeOperation ? publicOperationStatus(activeOperation) : undefined,
          versions: versions.stdout.trim().split("\n"),
          sandboxManifest,
          placementId: await sandbox.getContainerPlacementId(),
          processes: (await sandbox.listProcesses()).map((process) => ({ id: process.id, command: process.command, status: process.status }))
        });
      }

      return json({ error: "method_not_allowed" }, 405);
    } catch (error) {
      if (error instanceof SandboxOperationError) return json(error.payload, error.status);
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
      return json({ error: code ?? "sandbox_operation_failed", detail: error instanceof Error ? error.message : String(error) }, code === "source_policy_violation" ? 422 : 500);
    }
  }
} satisfies ExportedHandler<Env>;

class SandboxOperationError extends Error {
  constructor(
    readonly status: number,
    readonly payload: Record<string, unknown>
  ) {
    super(String(payload.error ?? "sandbox_operation_failed"));
  }
}

async function bootstrapWorkspace(
  sandbox: ReturnType<typeof getSandbox>,
  sessionId: string,
  publicBuildInput: unknown
) {
  await sandbox.killAllProcesses().catch(() => undefined);
  const publicInputJson = canonicalJson(publicBuildInput);
  const revision = await digest(`${sessionId}:bootstrap:${publicInputJson}`);
  const payloadHash = await digest(publicInputJson);
  const generationRoot = generationPath(revision);
  await sandbox.mkdir(generationsRoot, { recursive: true });
  await sandbox.mkdir(operationsRoot, { recursive: true });
  const existing = await readActiveGeneration(sandbox).catch(() => undefined);
  if (existing?.revision === revision && existing.publicInputHash === payloadHash) return revision;
  const initialized = await sandbox.exec([
    `rm -rf ${generationRoot}`,
    scaffoldGenerationCommand(generationRoot)
  ].join(" && "), { timeout: 30_000 });
  if (!initialized.success) {
    throw new SandboxOperationError(500, {
      error: "candidate_promotion_failed",
      detail: initialized.stderr.trim().slice(-4_000) || "Sandbox bootstrap generation could not be installed."
    });
  }
  await writeGenerationInput(sandbox, generationRoot, publicInputJson);
  await sandbox.writeFile(`${generationRoot}/.lodesta/revision`, revision);
  const source = await readSourceFilesAt(sandbox, generationRoot);
  await writeGenerationMetadata(sandbox, generationRoot, {
    schemaVersion: 1,
    revision,
    sourceHash: await digest(canonicalJson(source)),
    publicInputHash: payloadHash,
    operationId: await digest(`${sessionId}:bootstrap:${revision}`),
    payloadHash,
    status: "initialized",
    createdAt: new Date().toISOString()
  });
  const promoted = await sandbox.exec(`ln -s generations/${revision} ${nextActiveLink} && mv -Tf ${nextActiveLink} ${activeLink}`);
  if (!promoted.success) throw new SandboxOperationError(500, {
    error: "candidate_promotion_failed",
    detail: promoted.stderr.trim().slice(-4_000) || "Sandbox bootstrap pointer could not be installed."
  });
  const active = await readActiveGeneration(sandbox);
  if (active.revision !== revision) throw activeGenerationInvalid("Bootstrap pointer did not resolve to its generation.");
  return revision;
}

async function applyGeneration(
  sandbox: ReturnType<typeof getSandbox>,
  sessionId: string,
  body: ApplyRequest
) {
  const input = await sandbox.readFile(publicInputPath, { encoding: "utf8" });
  return submitGeneration(sandbox, sessionId, {
    action: "apply",
    expectedRevision: body.expectedRevision,
    files: canonicalFiles(body.files),
    publicInputJson: canonicalJson(JSON.parse(input.content))
  });
}

async function rebaseGeneration(
  sandbox: ReturnType<typeof getSandbox>,
  sessionId: string,
  body: { expectedRevision: string; publicBuildInput: unknown }
) {
  return submitGeneration(sandbox, sessionId, {
    action: "rebase",
    expectedRevision: body.expectedRevision,
    files: await readSourceFilesAt(sandbox, workspaceRoot),
    publicInputJson: canonicalJson(body.publicBuildInput)
  });
}

async function restoreGeneration(
  sandbox: ReturnType<typeof getSandbox>,
  sessionId: string,
  body: {
    backupId: string;
    expectedRevision: string;
    expectedArchiveHash: string;
    archiveBytes: ArrayBuffer;
  }
) {
  const archivePath = `/tmp/${body.backupId}.tar.gz`;
  const restoreRoot = `/tmp/lodesta-restore-${body.backupId}`;
  await sandbox.writeFile(archivePath, new Response(body.archiveBytes).body!);
  const extracted = await sandbox.exec(`rm -rf ${restoreRoot} && mkdir -p ${restoreRoot} && tar -xzf ${archivePath} -C ${restoreRoot}`, { timeout: 30_000 });
  if (!extracted.success) {
    await sandbox.deleteFile(archivePath).catch(() => undefined);
    throw new SandboxOperationError(422, { error: "restore_failed", stderr: extracted.stderr.slice(-8_000) });
  }
  try {
    await readArchivedRevision(sandbox, restoreRoot);
    const input = await sandbox.readFile(publicInputPath, { encoding: "utf8" });
    return await submitGeneration(sandbox, sessionId, {
      action: "restore",
      expectedRevision: body.expectedRevision,
      files: await readSourceFilesAt(sandbox, restoreRoot),
      publicInputJson: canonicalJson(JSON.parse(input.content)),
      extraPayload: { backupId: body.backupId, expectedArchiveHash: body.expectedArchiveHash }
    });
  } finally {
    await sandbox.exec(`rm -rf ${restoreRoot} ${archivePath}`).catch(() => undefined);
  }
}

async function submitGeneration(
  sandbox: ReturnType<typeof getSandbox>,
  sessionId: string,
  input: GenerationRequest
): Promise<OperationJournal> {
  const files = canonicalFiles(input.files);
  const payloadJson = canonicalJson({
    action: input.action,
    expectedRevision: input.expectedRevision,
    files,
    publicBuildInput: JSON.parse(input.publicInputJson),
    ...input.extraPayload
  });
  const payloadHash = await digest(payloadJson);
  const operationId = await digest(`${sessionId}:${input.action}:${input.expectedRevision}:${payloadHash}`);
  let retained = await readOperationJournal(sandbox, operationId);
  if (retained) {
    if (retained.payloadHash !== payloadHash) {
      throw new SandboxOperationError(409, { error: "operation_payload_conflict", operationId });
    }
    if (retained.status === "succeeded" && retained.result) {
      return { ...retained, result: { ...retained.result, replayed: true } };
    }
    return { ...retained, submissionReplayed: true };
  }
  await sandbox.mkdir(operationsRoot, { recursive: true });
  const acceptanceLock = `${operationsRoot}/${operationId}.accept.lock`;
  const accepted = await sandbox.exec(`mkdir ${acceptanceLock}`);
  if (!accepted.success) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      retained = await readOperationJournal(sandbox, operationId);
      if (retained) {
        if (retained.payloadHash !== payloadHash) {
          throw new SandboxOperationError(409, { error: "operation_payload_conflict", operationId });
        }
        return { ...retained, submissionReplayed: true };
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    throw new SandboxOperationError(409, { error: "operation_in_progress", operationId });
  }
  try {
    retained = await readOperationJournal(sandbox, operationId);
    if (retained) {
      if (retained.payloadHash !== payloadHash) {
        throw new SandboxOperationError(409, { error: "operation_payload_conflict", operationId });
      }
      return { ...retained, submissionReplayed: true };
    }
    const activeBeforeLock = await readActiveGeneration(sandbox);
    if (activeBeforeLock.operationId === operationId && activeBeforeLock.result) {
      if (activeBeforeLock.payloadHash !== payloadHash) {
        throw new SandboxOperationError(409, { error: "operation_payload_conflict", operationId });
      }
      const now = new Date().toISOString();
      return {
        schemaVersion: 1,
        operationId,
        payloadHash,
        status: "succeeded",
        phase: "complete",
        createdAt: activeBeforeLock.createdAt,
        updatedAt: now,
        phaseStartedAt: now,
        timestamps: { complete: now },
        phaseTimings: activeBeforeLock.result.phaseTimings,
        candidateRevision: activeBeforeLock.revision,
        result: { ...activeBeforeLock.result, replayed: true },
        completedAt: now
      };
    }
    const now = new Date().toISOString();
    const journal: OperationJournal = {
      schemaVersion: 1,
      operationId,
      payloadHash,
      status: "queued",
      phase: "queued",
      createdAt: now,
      updatedAt: now,
      phaseStartedAt: now,
      timestamps: { queued: now },
      phaseTimings: {}
    };
    await sandbox.writeFile(operationRequestPath(operationId), JSON.stringify({ ...input, files } satisfies GenerationRequest));
    await writeOperationJournal(sandbox, journal);
    return journal;
  } finally {
    await sandbox.exec(`rm -rf ${acceptanceLock}`).catch(() => undefined);
  }
}

async function operationStatus(
  sandbox: ReturnType<typeof getSandbox>,
  sessionId: string,
  origin: string,
  operationId: string,
  schedule: (work: Promise<unknown>) => void
) {
  const journal = await readOperationJournal(sandbox, operationId);
  if (!journal) throw new SandboxOperationError(404, { error: "operation_not_found", operationId });
  if (journal.status === "queued") {
    schedule(startQueuedOperation(sandbox, sessionId, origin, operationId));
  } else if (journal.status === "running" && journal.phase === "preparing") {
    schedule(recoverInterruptedPreparation(sandbox, sessionId, origin, journal));
  } else if (journal.status === "running" && (journal.phase === "validating" || journal.phase === "compiling")) {
    schedule(advanceRunningOperation(sandbox, sessionId, origin, journal));
  } else if (journal.status === "running" && journal.phase === "promoting") {
    schedule(finalizeBuiltOperation(sandbox, sessionId, origin, journal));
  }
  return publicOperationStatus(journal);
}

async function recoverInterruptedPreparation(
  sandbox: ReturnType<typeof getSandbox>,
  sessionId: string,
  origin: string,
  journal: OperationJournal
): Promise<OperationJournal> {
  // Preparation normally lasts only long enough to copy the immutable scaffold.
  // Let the original waiter finish unless it has stopped making progress.
  if (Date.now() - Date.parse(journal.phaseStartedAt) < 30_000) return journal;
  const input = await readJson<GenerationRequest>(sandbox, operationRequestPath(journal.operationId)).catch(() => undefined);
  if (!input) {
    return failOperation(sandbox, journal, new SandboxOperationError(500, { error: "operation_request_missing" }));
  }
  const revision = await digest(`${input.expectedRevision}:${input.action}:${journal.payloadHash}`);
  const processId = `lodesta-build-${journal.operationId.slice(0, 24)}`;
  const process = await sandbox.getProcess(processId).catch(() => null);
  if (process) {
    const now = new Date().toISOString();
    const resumed: OperationJournal = {
      ...journal,
      phase: "validating",
      updatedAt: now,
      phaseStartedAt: now,
      timestamps: { ...journal.timestamps, validating: journal.timestamps.validating ?? now },
      phaseTimings: {
        ...journal.phaseTimings,
        queueMs: journal.phaseTimings.queueMs ?? Math.max(0, Date.parse(journal.timestamps.preparing ?? now) - Date.parse(journal.createdAt)),
        prepareMs: journal.phaseTimings.prepareMs ?? Math.max(0, Date.parse(now) - Date.parse(journal.timestamps.preparing ?? now))
      },
      candidateRevision: revision,
      processId
    };
    await writeOperationJournal(sandbox, resumed);
    return advanceRunningOperation(sandbox, sessionId, origin, resumed);
  }

  // The request and deterministic operation identity are retained, so a lost
  // execution context can safely restart preparation without creating a
  // second logical mutation.
  await sandbox.exec(`rm -rf ${mutationLock}`).catch(() => undefined);
  const queued: OperationJournal = {
    ...journal,
    status: "queued",
    phase: "queued",
    updatedAt: new Date().toISOString(),
    phaseStartedAt: new Date().toISOString()
  };
  await writeOperationJournal(sandbox, queued);
  return startQueuedOperation(sandbox, sessionId, origin, journal.operationId);
}

async function startQueuedOperation(
  sandbox: ReturnType<typeof getSandbox>,
  sessionId: string,
  origin: string,
  operationId: string
): Promise<OperationJournal> {
  let journal = await readOperationJournal(sandbox, operationId);
  if (!journal) throw new SandboxOperationError(404, { error: "operation_not_found", operationId });
  if (journal.status !== "queued") return journal;
  try {
    await acquireMutationLock(sandbox, operationId);
  } catch (error) {
    if (error instanceof SandboxOperationError && error.payload.error === "operation_in_progress") return journal;
    throw error;
  }
  let candidateRoot: string | undefined;
  try {
    journal = await transitionOperation(sandbox, journal, "preparing");
    const input = await readJson<GenerationRequest>(sandbox, operationRequestPath(operationId));
    const active = await readActiveGeneration(sandbox);
    if (active.revision !== input.expectedRevision) {
      throw new SandboxOperationError(409, { error: "revision_conflict", currentRevision: active.revision });
    }
    await reconcileGenerationCleanup(sandbox, active.revision);
    const revision = await digest(`${input.expectedRevision}:${input.action}:${journal.payloadHash}`);
    candidateRoot = generationPath(revision);
    const prepareStarted = Date.now();
    const prepared = await sandbox.exec(`rm -rf ${candidateRoot} && ${scaffoldGenerationCommand(candidateRoot)}`, { timeout: 30_000 });
    if (!prepared.success) {
      throw new SandboxOperationError(500, { error: "candidate_cleanup_failed", detail: prepared.stderr.slice(-4_000) });
    }
    await writeGenerationInput(sandbox, candidateRoot, input.publicInputJson);
    await writeGenerationSource(sandbox, candidateRoot, input.files);
    const sourcePolicyInput = `/tmp/lodesta-source-policy-${operationId}.json`;
    const validationMarker = operationValidationMarker(candidateRoot, operationId);
    const runtimeSeriesId = (JSON.parse(input.publicInputJson) as { capabilityConfiguration?: { trustedRuntimeSeries?: unknown } })
      .capabilityConfiguration?.trustedRuntimeSeries;
    await sandbox.writeFile(sourcePolicyInput, JSON.stringify({
      files: input.files,
      runtimeSeriesId: typeof runtimeSeriesId === "string" ? runtimeSeriesId : undefined
    }));
    const validationCompleteCommand = `node -e 'require("fs").writeFileSync("${validationMarker}", String(Date.now()))'`;
    const process = await sandbox.startProcess(
      `npm run validate-source -- ${sourcePolicyInput} && ${validationCompleteCommand} && npm run build`,
      {
        cwd: candidateRoot,
        timeout: 150_000,
        processId: `lodesta-build-${operationId.slice(0, 24)}`,
        autoCleanup: false
      }
    );
    const now = new Date().toISOString();
    journal = {
      ...journal,
      status: "running",
      phase: "validating",
      updatedAt: now,
      phaseStartedAt: now,
      timestamps: { ...journal.timestamps, validating: now },
      phaseTimings: {
        ...journal.phaseTimings,
        queueMs: Math.max(0, Date.parse(journal.timestamps.preparing ?? now) - Date.parse(journal.createdAt)),
        prepareMs: Date.now() - prepareStarted
      },
      candidateRevision: revision,
      processId: process.id
    };
    await writeOperationJournal(sandbox, journal);
    return journal;
  } catch (error) {
    return failOperation(sandbox, journal, error, candidateRoot);
  }
}

async function advanceRunningOperation(
  sandbox: ReturnType<typeof getSandbox>,
  sessionId: string,
  origin: string,
  journal: OperationJournal
): Promise<OperationJournal> {
  if (!journal.processId || !journal.candidateRevision) {
    return failOperation(sandbox, journal, new SandboxOperationError(500, { error: "build_process_missing" }));
  }
  const processId = journal.processId;
  const candidateRoot = generationPath(journal.candidateRevision);
  const validationMarker = operationValidationMarker(candidateRoot, journal.operationId);
  const validationPassed = await sandbox.exists(validationMarker);
  if (validationPassed.exists && journal.phase === "validating") {
    const validationCompletedAt = Number((await sandbox.readFile(validationMarker, { encoding: "utf8" })).content.trim());
    const compilingAt = Number.isFinite(validationCompletedAt) ? new Date(validationCompletedAt).toISOString() : new Date().toISOString();
    journal = {
      ...journal,
      phase: "compiling",
      updatedAt: compilingAt,
      phaseStartedAt: compilingAt,
      timestamps: { ...journal.timestamps, compiling: compilingAt },
      phaseTimings: {
        ...journal.phaseTimings,
        validationMs: Math.max(0, Date.parse(compilingAt) - Date.parse(journal.timestamps.validating ?? compilingAt))
      }
    };
    await writeOperationJournal(sandbox, journal);
  }
  const process = await sandbox.getProcess(processId);
  if (process && (process.status === "starting" || process.status === "running")) return journal;
  const logs = process
    ? await process.getLogs()
    : await sandbox.getProcessLogs(processId).catch(() => ({ stdout: "", stderr: "" }));
  const status = process ? await process.getStatus().catch(() => process.status) : "error";
  const exitCode = process?.exitCode;
  if (status !== "completed" || exitCode !== 0) {
    const sourcePolicyFailed = !validationPassed.exists;
    return failOperation(sandbox, journal, new SandboxOperationError(
      sourcePolicyFailed ? 422 : status === "killed" || /timeout|timed out/i.test(`${logs.stderr}\n${logs.stdout}`) ? 504 : 422,
      sourcePolicyFailed
        ? {
            error: "source_policy_violation",
            ...parseSourcePolicyResult(logs.stdout),
            detail: logs.stderr.trim().slice(-4_000) || "Generated source failed the sandbox source policy."
          }
        : {
            error: status === "killed" || /timeout|timed out/i.test(`${logs.stderr}\n${logs.stdout}`) ? "build_timeout" : "build_failed",
            stdout: logs.stdout.slice(-12_000),
            stderr: logs.stderr.slice(-12_000)
          }
    ), candidateRoot);
  }
  const now = new Date().toISOString();
  journal = {
    ...journal,
    phase: "promoting",
    updatedAt: now,
    phaseStartedAt: now,
    timestamps: { ...journal.timestamps, promoting: now },
    phaseTimings: {
      ...journal.phaseTimings,
      buildMs: Math.max(0, Date.parse(now) - Date.parse(journal.timestamps.compiling ?? now))
    }
  };
  await writeOperationJournal(sandbox, journal);
  return finalizeBuiltOperation(sandbox, sessionId, origin, journal);
}

async function finalizeBuiltOperation(
  sandbox: ReturnType<typeof getSandbox>,
  sessionId: string,
  origin: string,
  journal: OperationJournal
): Promise<OperationJournal> {
  if (!journal.candidateRevision) {
    return failOperation(sandbox, journal, new SandboxOperationError(500, { error: "candidate_revision_missing" }));
  }
  const finalizationLock = `${operationsRoot}/${journal.operationId}.finalize.lock`;
  const locked = await sandbox.exec(`mkdir ${finalizationLock}`);
  if (!locked.success) return (await readOperationJournal(sandbox, journal.operationId)) ?? journal;
  const candidateRoot = generationPath(journal.candidateRevision);
  let promoted = false;
  try {
    const current = await readOperationJournal(sandbox, journal.operationId);
    if (!current || current.status !== "running" || current.phase !== "promoting" || !current.candidateRevision) return current ?? journal;
    journal = current;
    const candidateRevision = current.candidateRevision;
    const input = await readJson<GenerationRequest>(sandbox, operationRequestPath(journal.operationId));
    const placementId = await sandbox.getContainerPlacementId();
    if (!placementId) {
      throw new SandboxOperationError(500, {
        error: "candidate_promotion_failed",
        detail: "Sandbox placement identity is unavailable before promotion."
      });
    }
    const promotionStarted = Date.now();
    const result: BuildSuccess = {
      ok: true,
      revision: candidateRevision,
      previewUrl: `${origin}/v1/sessions/${sessionId}/preview/`,
      buildDurationMs: journal.phaseTimings.buildMs ?? 0,
      placementId,
      operationId: journal.operationId,
      activeGenerationRevision: candidateRevision,
      phaseTimings: journal.phaseTimings
    };
    await sandbox.writeFile(`${candidateRoot}/.lodesta/revision`, candidateRevision);
    await writeGenerationMetadata(sandbox, candidateRoot, {
      schemaVersion: 1,
      revision: candidateRevision,
      sourceHash: await digest(canonicalJson(input.files)),
      publicInputHash: await digest(input.publicInputJson),
      operationId: journal.operationId,
      payloadHash: journal.payloadHash,
      status: "built",
      createdAt: journal.createdAt,
      result
    });
    const completedAt = new Date().toISOString();
    const completed: OperationJournal = {
      ...journal,
      status: "succeeded",
      phase: "complete",
      updatedAt: completedAt,
      phaseStartedAt: completedAt,
      timestamps: { ...journal.timestamps, complete: completedAt },
      phaseTimings: {
        ...journal.phaseTimings,
        promotionMs: 0,
        totalMs: Math.max(0, Date.parse(completedAt) - Date.parse(journal.createdAt))
      },
      result,
      completedAt
    };
    result.phaseTimings = completed.phaseTimings;
    try {
      await promoteGenerationTransaction({
        target: `generations/${candidateRevision}`,
        journal: completed,
        adapter: {
          removeNextPointer: async () => {
            const removed = await sandbox.exec(`rm -f ${nextActiveLink}`);
            if (!removed.success) throw candidatePromotionFailed(removed.stderr, "Stale next-generation pointer could not be removed.");
          },
          createNextPointer: async (target) => {
            const linked = await sandbox.exec(`ln -s ${target} ${nextActiveLink}`);
            if (!linked.success) throw candidatePromotionFailed(linked.stderr, "Next-generation pointer could not be created.");
          },
          replaceActivePointer: async () => {
            const replaced = await sandbox.exec(`mv -Tf ${nextActiveLink} ${activeLink}`);
            if (!replaced.success) throw candidatePromotionFailed(replaced.stderr, "Atomic active-generation rename failed.");
          },
          readActive: () => readActiveGeneration(sandbox),
          writeOperationJournal: (value) => writeOperationJournal(sandbox, value),
          cleanupOldGenerations: () => garbageCollectGenerations(sandbox, candidateRevision)
        },
        validateActive: (activeAfter) => {
          if (activeAfter.revision !== candidateRevision || activeAfter.operationId !== journal.operationId) {
            throw activeGenerationInvalid("Atomic promotion read-back did not match the candidate generation.");
          }
        },
        onPointerReplaced: () => {
          promoted = true;
          completed.phaseTimings.promotionMs = Date.now() - promotionStarted;
          completed.phaseTimings.totalMs = Date.now() - Date.parse(journal.createdAt);
          result.phaseTimings = completed.phaseTimings;
        }
      });
      await sandbox.deleteFile(cleanupPendingPath).catch(() => undefined);
    } catch (error) {
      if (!promoted) throw error;
      if (!(error instanceof SandboxOperationError) || error.payload.error !== "candidate_cleanup_failed") throw error;
      result.warnings = ["candidate_cleanup_failed"];
      await writeOperationJournal(sandbox, completed);
      await sandbox.writeFile(cleanupPendingPath, JSON.stringify({
        activeRevision: candidateRevision,
        operationId: journal.operationId,
        recordedAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : String(error)
      })).catch(() => undefined);
    }
    await cleanupOperationProcess(sandbox, journal);
    await sandbox.exec(`rm -rf ${mutationLock}`).catch(() => undefined);
    return completed;
  } catch (error) {
    if (promoted) {
      const active = await readActiveGeneration(sandbox).catch(() => undefined);
      if (active?.operationId === journal.operationId && active.result) {
        const now = new Date().toISOString();
        const recovered: OperationJournal = {
          ...journal,
          status: "succeeded",
          phase: "complete",
          updatedAt: now,
          phaseStartedAt: now,
          timestamps: { ...journal.timestamps, complete: now },
          phaseTimings: active.result.phaseTimings,
          result: active.result,
          completedAt: now
        };
        await writeOperationJournal(sandbox, recovered);
        return recovered;
      }
    }
    return failOperation(sandbox, journal, error, candidateRoot);
  } finally {
    await sandbox.exec(`rm -rf ${finalizationLock}`).catch(() => undefined);
  }
}

async function failOperation(
  sandbox: ReturnType<typeof getSandbox>,
  journal: OperationJournal,
  error: unknown,
  candidateRoot?: string
): Promise<OperationJournal> {
  const failure = error instanceof SandboxOperationError
    ? { status: error.status, payload: error.payload }
    : { status: 500, payload: { error: "sandbox_operation_failed", detail: error instanceof Error ? error.message : String(error) } };
  const now = new Date().toISOString();
  const failed: OperationJournal = {
    ...journal,
    status: "failed",
    phase: "complete",
    updatedAt: now,
    phaseStartedAt: now,
    timestamps: { ...journal.timestamps, complete: now },
    phaseTimings: {
      ...journal.phaseTimings,
      totalMs: Math.max(0, Date.parse(now) - Date.parse(journal.createdAt))
    },
    failure,
    completedAt: now
  };
  await writeOperationJournal(sandbox, failed);
  await cleanupOperationProcess(sandbox, journal);
  if (candidateRoot) await sandbox.exec(`rm -rf ${candidateRoot}`).catch(() => undefined);
  await sandbox.exec(`rm -rf ${mutationLock}`).catch(() => undefined);
  return failed;
}

async function cleanupOperationProcess(sandbox: ReturnType<typeof getSandbox>, journal: OperationJournal) {
  if (journal.processId) {
    const process = await sandbox.getProcess(journal.processId).catch(() => null);
    if (process && (process.status === "starting" || process.status === "running")) await process.kill().catch(() => undefined);
  }
  await sandbox.deleteFile(`/tmp/lodesta-source-policy-${journal.operationId}.json`).catch(() => undefined);
  await sandbox.deleteFile(operationRequestPath(journal.operationId)).catch(() => undefined);
  await sandbox.cleanupCompletedProcesses().catch(() => undefined);
}

async function transitionOperation(
  sandbox: ReturnType<typeof getSandbox>,
  journal: OperationJournal,
  phase: OperationPhase
) {
  const now = new Date().toISOString();
  const next = {
    ...journal,
    status: "running" as const,
    phase,
    updatedAt: now,
    phaseStartedAt: now,
    timestamps: { ...journal.timestamps, [phase]: now }
  };
  await writeOperationJournal(sandbox, next);
  return next;
}

function publicOperationStatus(journal: OperationJournal) {
  return {
    ok: journal.status !== "failed",
    operationId: journal.operationId,
    status: journal.status,
    phase: journal.phase,
    createdAt: journal.createdAt,
    updatedAt: journal.updatedAt,
    phaseStartedAt: journal.phaseStartedAt,
    timestamps: journal.timestamps,
    phaseTimings: journal.phaseTimings,
    result: journal.result,
    failure: journal.failure,
    submissionReplayed: journal.submissionReplayed
  };
}

function operationRequestPath(operationId: string) {
  return `${operationsRoot}/${operationId}${operationRequestSuffix}`;
}

function operationValidationMarker(candidateRoot: string, operationId: string) {
  return `${candidateRoot}/.lodesta/${operationId}${operationValidationSuffix}`;
}

function candidatePromotionFailed(stderr: string, fallback: string) {
  return new SandboxOperationError(500, {
    error: "candidate_promotion_failed",
    detail: stderr.trim().slice(-4_000) || fallback
  });
}

async function acquireMutationLock(sandbox: ReturnType<typeof getSandbox>, operationId: string) {
  await sandbox.mkdir(sessionRoot, { recursive: true });
  const acquired = await sandbox.exec(`mkdir ${mutationLock}`);
  if (acquired.success) {
    await sandbox.writeFile(`${mutationLock}/lock.json`, JSON.stringify({ operationId, startedAt: new Date().toISOString() }));
    return;
  }
  const lock = await readJson<{ operationId?: string; startedAt?: string }>(sandbox, `${mutationLock}/lock.json`).catch(() => undefined);
  const startedAt = lock?.startedAt ? Date.parse(lock.startedAt) : Number.NaN;
  const stale = !Number.isFinite(startedAt) || Date.now() - startedAt >= operationStaleAfterMs;
  if (!stale) {
    throw new SandboxOperationError(409, { error: "operation_in_progress", operationId: lock?.operationId });
  }
  const associatedProcessRunning = (await sandbox.listProcesses()).some((process) =>
    process.status === "running" && !process.command.includes(`--port ${previewPort}`)
  );
  if (associatedProcessRunning) throw new SandboxOperationError(409, { error: "operation_in_progress", operationId: lock?.operationId });
  await sandbox.exec(`rm -rf ${mutationLock}`);
  const retried = await sandbox.exec(`mkdir ${mutationLock}`);
  if (!retried.success) throw new SandboxOperationError(409, { error: "operation_in_progress", operationId: lock?.operationId });
  await sandbox.writeFile(`${mutationLock}/lock.json`, JSON.stringify({ operationId, startedAt: new Date().toISOString(), reconciled: true }));
}

async function readOperationJournal(
  sandbox: ReturnType<typeof getSandbox>,
  operationId: string
) {
  const journal = await readJson<OperationJournal>(sandbox, `${operationsRoot}/${operationId}.json`).catch(() => undefined);
  if (!journal) return undefined;
  if (journal.operationId !== operationId || journal.schemaVersion !== 1) {
    throw new SandboxOperationError(500, { error: "operation_journal_invalid", operationId });
  }
  return journal;
}

async function writeOperationJournal(sandbox: ReturnType<typeof getSandbox>, journal: OperationJournal) {
  await sandbox.mkdir(operationsRoot, { recursive: true });
  await sandbox.writeFile(`${operationsRoot}/${journal.operationId}.json`, JSON.stringify(journal));
}

async function writeGenerationSource(
  sandbox: ReturnType<typeof getSandbox>,
  root: string,
  files: Array<{ path: string; content: string }>
) {
  await sandbox.exec(`rm -rf ${root}/src && mkdir -p ${root}/src`);
  for (const file of files) {
    const path = `${root}/${file.path}`;
    await sandbox.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await sandbox.writeFile(path, file.content);
  }
}

async function writeGenerationInput(sandbox: ReturnType<typeof getSandbox>, root: string, publicInputJson: string) {
  await sandbox.writeFile(`${root}/public-build-input.json`, publicInputJson);
  await sandbox.exec(`rm -f ${root}/.lodesta/public-build-input.json && ln -s ../public-build-input.json ${root}/.lodesta/public-build-input.json`);
  const publicInput = JSON.parse(publicInputJson) as { capabilityConfiguration?: { trustedRuntimeSeries?: unknown } };
  const runtimeSeriesId = publicInput.capabilityConfiguration?.trustedRuntimeSeries;
  if (runtimeSeriesId !== "site-runtime-v4") throw new Error("unsupported_authoring_runtime_series");
  const packageFile = await sandbox.readFile(`${root}/package.json`, { encoding: "utf8" });
  const packageJson = JSON.parse(packageFile.content) as { imports?: Record<string, string> };
  packageJson.imports = { ...packageJson.imports, "#lodesta-sdk": "./platform/sdk-v4.tsx" };
  await sandbox.writeFile(`${root}/package.json`, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function writeGenerationMetadata(sandbox: ReturnType<typeof getSandbox>, root: string, metadata: GenerationMetadata) {
  await sandbox.writeFile(`${root}/generation.json`, JSON.stringify(metadata));
}

async function readActiveGeneration(sandbox: ReturnType<typeof getSandbox>): Promise<GenerationMetadata> {
  const pointer = await sandbox.exec(`readlink ${activeLink}`);
  const target = pointer.success ? pointer.stdout.trim() : "";
  if (!/^generations\/[a-f0-9]{64}$/.test(target)) throw activeGenerationInvalid("Active generation pointer is missing or malformed.");
  const metadata = await readJson<GenerationMetadata>(sandbox, `${sessionRoot}/${target}/generation.json`).catch(() => undefined);
  if (!metadata
    || metadata.schemaVersion !== 1
    || metadata.revision !== target.slice("generations/".length)
    || !/^[a-f0-9]{64}$/.test(metadata.revision)) {
    throw activeGenerationInvalid("Active generation metadata is missing or inconsistent.");
  }
  return metadata;
}

async function readJson<T>(sandbox: ReturnType<typeof getSandbox>, path: string): Promise<T> {
  const exists = await sandbox.exists(path);
  if (!exists.exists) throw new Error(`Missing JSON file ${path}.`);
  const file = await sandbox.readFile(path, { encoding: "utf8" });
  return JSON.parse(file.content) as T;
}

async function readSourceFilesAt(sandbox: ReturnType<typeof getSandbox>, root: string) {
  const listed = await sandbox.exec(`find ${root}/src -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \\) -print | sort`);
  if (!listed.success) throw new SandboxOperationError(404, { error: "source_unavailable" });
  const paths = listed.stdout.trim().split("\n").filter(Boolean);
  if (paths.length > maxFilesPerApply) throw new SandboxOperationError(413, { error: "source_file_limit" });
  const files = [];
  for (const absolutePath of paths) {
    if (!absolutePath.startsWith(`${root}/src/`) || absolutePath.includes("..")) {
      throw new SandboxOperationError(500, { error: "source_path_violation" });
    }
    const file = await sandbox.readFile(absolutePath, { encoding: "utf8" });
    files.push({ path: absolutePath.slice(`${root}/`.length), content: file.content });
  }
  return canonicalFiles(files);
}

async function readArchivedRevision(sandbox: ReturnType<typeof getSandbox>, root: string) {
  const metadata = await readJson<GenerationMetadata>(sandbox, `${root}/generation.json`).catch(() => undefined);
  if (metadata?.revision && /^[a-f0-9]{64}$/.test(metadata.revision)) return metadata.revision;
  const revision = await sandbox.readFile(`${root}/.lodesta/revision`, { encoding: "utf8" }).catch(() => undefined);
  const value = revision?.content.trim();
  if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new SandboxOperationError(422, { error: "restore_failed", detail: "Backup revision is missing or malformed." });
  return value;
}

async function garbageCollectGenerations(sandbox: ReturnType<typeof getSandbox>, activeRevision: string) {
  const result = await sandbox.exec(`find ${generationsRoot} -mindepth 1 -maxdepth 1 ! -name ${activeRevision} -exec rm -rf {} +`, { timeout: 30_000 });
  if (!result.success) throw new SandboxOperationError(500, { error: "candidate_cleanup_failed", detail: result.stderr.slice(-4_000) });
}

async function reconcileGenerationCleanup(sandbox: ReturnType<typeof getSandbox>, activeRevision: string) {
  const pending = await sandbox.exists(cleanupPendingPath);
  if (!pending.exists) {
    const listed = await sandbox.exec(`find ${generationsRoot} -mindepth 1 -maxdepth 1 -type d | head -n 2`);
    const generations = listed.success ? listed.stdout.trim().split("\n").filter(Boolean) : [];
    if (generations.length <= 1) return;
  }
  await garbageCollectGenerations(sandbox, activeRevision);
  await sandbox.deleteFile(cleanupPendingPath).catch(() => undefined);
}

function scaffoldGenerationCommand(root: string) {
  return `mkdir -p ${root} && cp -R /opt/lodesta-site-scaffold/. ${root}/ && rm -rf ${root}/node_modules ${root}/dist && ln -s /opt/lodesta-site-scaffold/node_modules ${root}/node_modules && mkdir -p ${root}/.lodesta`;
}

function generationPath(revision: string) {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("Generation revision is invalid.");
  return `${generationsRoot}/${revision}`;
}

function activeGenerationInvalid(detail: string) {
  return new SandboxOperationError(500, { error: "active_generation_invalid", detail });
}

function canonicalFiles(files: Array<{ path: string; content: string }>) {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sandboxFor(env: Env, sessionId: string) {
  return getSandbox(env.Sandbox, sessionId, { normalizeId: true, sleepAfter: "10m", keepAlive: false, enableDefaultSession: true });
}

function authorized(request: Request, env: Env) {
  return Boolean(env.SANDBOX_TOKEN && request.headers.get("authorization") === `Bearer ${env.SANDBOX_TOKEN}`);
}

function validateApply(value: unknown): ApplyRequest {
  if (!value || typeof value !== "object") throw new Error("Apply body must be an object.");
  const record = value as Record<string, unknown>;
  if (typeof record.expectedRevision !== "string" || !record.expectedRevision) throw new Error("expectedRevision is required.");
  if (!Array.isArray(record.files) || record.files.length < 1 || record.files.length > maxFilesPerApply) throw new Error("files has an invalid length.");
  const files = record.files.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Each file must be an object.");
    const file = entry as Record<string, unknown>;
    if (typeof file.path !== "string" || !/^src\/[a-zA-Z0-9_./-]+\.(?:css|ts|tsx)$/.test(file.path) || file.path.includes("..")) throw new Error("File path is outside the source allowlist.");
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

async function readRevision(sandbox: ReturnType<typeof getSandbox>) {
  const exists = await sandbox.exists(revisionPath);
  return exists.exists ? (await sandbox.readFile(revisionPath, { encoding: "utf8" })).content.trim() : "uninitialized";
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
  headers.set("content-security-policy", "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'none'; connect-src 'none'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
}

async function ensurePreviewServer(sessionId: string, sandbox: ReturnType<typeof getSandbox>) {
  const current = previewStarts.get(sessionId);
  if (current) return current;
  const start = (async () => {
    const lockPath = `${sessionRoot}/preview-start.lock`;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await previewServerReady(sandbox)) return;
      const processes = await sandbox.listProcesses();
      const running = processes.some((process) => process.status === "running" && process.command.includes(`--port ${previewPort}`));
      if (!running) {
        const lock = await sandbox.exec(`mkdir ${lockPath}`);
        if (lock.success) {
          try {
            if (await previewServerReady(sandbox)) return;
            const afterLock = await sandbox.listProcesses();
            const alreadyRunning = afterLock.some((process) => process.status === "running" && process.command.includes(`--port ${previewPort}`));
            if (!alreadyRunning) {
              const server = await sandbox.startProcess(
                `node /opt/lodesta-site-scaffold/platform/preview-server.mjs --host 0.0.0.0 --port ${previewPort}`,
                { cwd: sessionRoot }
              );
              await server.waitForPort(previewPort, { path: "/", status: 200, timeout: 30_000 });
            }
            if (!await previewServerReady(sandbox)) throw new Error("Preview process started without becoming reachable.");
            return;
          } finally {
            await sandbox.exec(`rmdir ${lockPath}`).catch(() => undefined);
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Concurrent preview start did not become ready.");
  })();
  previewStarts.set(sessionId, start);
  try {
    await start;
  } finally {
    if (previewStarts.get(sessionId) === start) previewStarts.delete(sessionId);
  }
}

async function previewServerReady(sandbox: ReturnType<typeof getSandbox>) {
  try {
    const response = await sandbox.containerFetch(new Request("http://lodesta-preview.local/"), previewPort);
    const ready = response.status === 200;
    await response.body?.cancel();
    return ready;
  } catch {
    return false;
  }
}
