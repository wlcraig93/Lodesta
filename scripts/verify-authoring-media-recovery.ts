import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { LocalArtifactBlobStore, workspaceSourceSidecarSchema } from "../packages/site-artifacts";
import { LocalSitePlatformRepository } from "../packages/platform-data/repository";
import { ManagerNeedsInputError, type WebsiteManagerAgent, type WorkspaceSourceFile } from "../packages/site-agent";
import { siteAgentRunGuardrailsForKind } from "../packages/site-agent/run-policy";
import {
  businessStateSchema,
  expectedSiteSandboxManifest,
  siteAgentRunSchema,
  siteAgentSessionSchema,
  siteSandboxControlSchema,
  siteSandboxDeploymentSchema,
  sourceSnapshotPageSchema,
  sourceSnapshotResourceSchema,
  sourceSnapshotSchema,
  type SitePublicBuildInput
} from "../packages/site-contracts";
import { sandboxImageDigest } from "../packages/site-contracts/platform-manifest";
import { sha256, stableJson } from "../packages/business-data";
import { SiteAuthoringWorkflow } from "../packages/site-platform/workflow";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

// This stays entirely local: the real workflow, local repository, and blob
// store run with two fresh sandbox stubs and two deterministic media bytes.
// It deliberately stops at needs_input rather than producing a candidate.
const directory = await mkdtemp(join(tmpdir(), "lodesta-media-recovery-"));
try {
  const repository = new LocalSitePlatformRepository(join(directory, "repository.json"));
  const store = new LocalArtifactBlobStore(join(directory, "blobs"));
  const input = buildSyntheticSiteInput();
  const now = "2026-09-10T15:00:00.000Z";
  const owner = "58c3a17e-6ad5-4e2c-9eb3-90e71527a054";
  const sourceSnapshot = sourceSnapshotSchema.parse({
    schemaVersion: 1,
    id: "source_owner",
    businessId: input.businessId,
    sourceType: "owner_input",
    contentHash: sha256("media-recovery-source"),
    capturedAt: now,
    payload: { fixture: "media-recovery" }
  });
  const sourcePng = await sharp({
    create: { width: 32, height: 24, channels: 3, background: "#2b614e" }
  }).png().toBuffer();
  const sourceResource = sourceSnapshotResourceSchema.parse({
    schemaVersion: 1,
    id: "resource_recovery_photo",
    sourceSnapshotId: sourceSnapshot.id,
    captureKind: "http_response",
    role: "image",
    requestedUrl: "https://northstar.example/yard.png",
    finalUrl: "https://northstar.example/yard.png",
    outcome: "fetched",
    status: 200,
    contentType: "image/png",
    storedEncoding: "identity",
    rawContentHash: sha256(sourcePng),
    blobContentHash: sha256(sourcePng),
    storageKey: "fixture/recovery-source.png",
    rawBytes: sourcePng.length,
    storedBytes: sourcePng.length,
    headers: {},
    redirectChain: [],
    initiatorUrls: ["https://northstar.example/"],
    capturedAt: now,
    metadata: {}
  });
  const sourcePage = sourceSnapshotPageSchema.parse({
    schemaVersion: 1,
    id: "page_recovery_home",
    sourceSnapshotId: sourceSnapshot.id,
    resourceId: sourceResource.id,
    requestedUrl: "https://northstar.example/",
    finalUrl: "https://northstar.example/",
    path: "/",
    outcome: "fetched",
    indexability: "indexable",
    headings: ["Northstar Collision Repair"],
    wordCount: 3,
    internalLinks: [],
    externalLinks: [],
    linkProminence: 1,
    extractedText: "Northstar Collision Repair",
    textContentHash: sha256("Northstar Collision Repair"),
    producer: "fixture",
    inputHash: sha256("media-recovery"),
    createdAt: now
  });
  const stateBody = {
    schemaVersion: 1 as const,
    businessId: input.businessId,
    siteId: input.siteId,
    revision: 1,
    ownerOperationalRevision: input.ownerOperationalRevision,
    updatedAt: now,
    identity: { name: input.business.name, status: input.business.identityStatus, description: input.business.description, categories: [] },
    contacts: input.business.contacts,
    locations: input.business.locations,
    serviceAreas: input.business.serviceAreas,
    offerings: input.business.offerings,
    proof: input.business.proof,
    assets: input.business.assets,
    links: input.business.links,
    facts: input.publicFacts
  };
  await repository.createSite({
    id: input.siteId,
    ownerUserId: owner,
    businessId: input.businessId,
    sourceUrl: "https://northstar.example/",
    slug: "media-recovery-fixture",
    status: "draft",
    reportingTimezone: "UTC",
    currentPublicBuildInputId: input.id,
    createdAt: now,
    updatedAt: now
  });
  await repository.saveBusinessState(businessStateSchema.parse({ ...stateBody, stateHash: sha256(stableJson(stateBody)) }));
  await repository.saveSiteIntent(input.intent);
  for (const form of input.forms) await repository.saveFormDefinition(form);
  await repository.savePublicBuildInput(input);
  await repository.saveSourceSnapshot(sourceSnapshot);
  await repository.saveSourceSnapshotResources([sourceResource]);
  await repository.saveSourceSnapshotPages([sourcePage]);
  await store.putImmutable({
    key: sourceResource.storageKey!,
    bytes: sourcePng,
    contentType: "image/png",
    contentHash: sha256(sourcePng)
  });

  const deployment = siteSandboxDeploymentSchema.parse({
    schemaVersion: 1,
    id: "sandbox_deployment_media_recovery",
    slot: "blue",
    workerVersionId: "fixture-worker",
    releaseSha: "a".repeat(40),
    imageDigest: sandboxImageDigest,
    credentialSlot: "blue",
    manifest: expectedSiteSandboxManifest,
    createdAt: now
  });
  await repository.saveSandboxDeployment(deployment);
  await repository.saveSandboxControl(siteSandboxControlSchema.parse({
    schemaVersion: 1,
    id: "production",
    blueDeploymentId: deployment.id,
    activeDeploymentId: deployment.id,
    updatedAt: now
  }));
  const session = siteAgentSessionSchema.parse({
    schemaVersion: "site-agent-session",
    id: "session_media_recovery",
    siteId: input.siteId,
    principal: { kind: "owner", id: owner },
    status: "active",
    publicBuildInputId: input.id,
    sandboxProvider: "cloudflare",
    leaseTokenHash: sha256("media-recovery-lease"),
    leaseExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    rotateAt: new Date(Date.now() + 7_200_000).toISOString(),
    createdAt: now,
    updatedAt: now
  });
  const run = siteAgentRunSchema.parse({
    schemaVersion: "site-agent-run",
    id: "run_media_recovery",
    sessionId: session.id,
    siteId: input.siteId,
    publicBuildInputId: input.id,
    request: { kind: "owner_instruction", messageIds: ["message_media_recovery"] },
    origin: "owner_request",
    requestedBy: owner,
    kind: "initial_build",
    status: "queued",
    stage: "architecting",
    executionNumber: 1,
    sandboxDeploymentId: deployment.id,
    apiProvider: "openai",
    modelId: "gpt-5.6-sol",
    skillVersions: {},
    guardrails: siteAgentRunGuardrailsForKind("initial_build", new Date().toISOString()),
    usage: {
      inputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, outputTokens: 0,
      costUsd: 0, costSource: "unavailable", upstreamInferenceCostUsd: 0, durationMs: 0
    },
    startedAt: now
  });
  await repository.saveAgentSession(session);
  await repository.saveAgentRun(run);

  const generatedBytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#9e7044" }
  }).webp().toBuffer();
  const initialFiles = fixtureWorkspaceFiles();
  let imageCreatorCalls = 0;
  let firstManagerCalls = 0;
  let resumedManagerCalls = 0;
  const firstSandbox = createSandbox({ store, initialFiles, label: "first" });
  const firstManager = {
    run: async ({ runtime }: Parameters<WebsiteManagerAgent["run"]>[0]) => {
      firstManagerCalls += 1;
      const generated = await runtime.execute({
        callId: "generated_media",
        name: "create_image",
        arguments: {
          action: "generate",
          purpose: "background",
          prompt: "Fixture only: an abstract repair texture.",
          sourceAssetIds: [],
          size: "1024x1024",
          alt: "Fixture generated texture"
        }
      });
      assert.equal(generated.diagnosticOutput.ok, true);
      const adopted = await runtime.execute({
        callId: "adopted_media",
        name: "adopt_source_asset",
        arguments: {
          sourceId: sourceSnapshot.id,
          resourceId: sourceResource.id,
          sourcePageId: sourcePage.id,
          kind: "photo",
          alt: "Fixture source yard"
        }
      });
      assert.equal(adopted.diagnosticOutput.ok, true);
      const generatedRef = generated.diagnosticOutput.asset as { assetId: string; revisionId: string };
      const adoptedRef = adopted.diagnosticOutput.asset as { assetId: string; revisionId: string };
      await runtime.execute({
        callId: "reference_recovered_media",
        name: "write_file",
        arguments: {
          path: "src/site.tsx",
          content: `import { Asset } from "#lodesta-sdk"; export const siteDefinition = { routes: [{ path: '/', element: <main><h1>Northstar</h1><Asset id=${JSON.stringify(generatedRef.assetId)} /><Asset id=${JSON.stringify(adoptedRef.assetId)} /></main> }] };`
        }
      });
      const built = await runtime.execute({ callId: "persist_media_references", name: "build_preview", arguments: {} });
      assert.equal(built.diagnosticOutput.ok, true);
      const configured = await runtime.execute({
        callId: "preserved_form",
        name: "configure_lead_form",
        arguments: { ...input.forms[0]!, expectedRevision: 1, submitLabel: "Ask about a repair" }
      });
      assert.equal(configured.diagnosticOutput.ok, true);
      throw new ManagerNeedsInputError("Which paint color should the fixture use?");
    }
  };
  const imageCreator = async () => {
    imageCreatorCalls += 1;
    return {
      bytes: generatedBytes,
      mimeType: "image/webp",
      width: 16,
      height: 16,
      sourceAssetRevisionIds: [],
      usage: {
        inputTokens: 0, outputTokens: 0, costUsd: 0, costSource: "unavailable" as const,
        upstreamInferenceCostUsd: 0, durationMs: 1
      }
    };
  };
  const firstWorkflow = new SiteAuthoringWorkflow(
    repository, store, firstSandbox as never, firstManager as never, undefined, imageCreator as never, deployment
  );
  const paused = await firstWorkflow.executeRun(run.id);
  assert.equal(paused.status, "needs_input", paused.failureReason);
  assert.equal(firstManagerCalls, 1);
  assert.equal(imageCreatorCalls, 1);
  assert.equal(paused.provisionalMedia?.revisions.length, 2, "Both generated and adopted media must be durable before pausing.");
  assert.deepEqual(new Set(paused.provisionalMedia?.refs.map((ref) => ref.origin)), new Set(["platform_generated", "source_website"]));
  const retainedAfterPause = (await repository.getPublicBuildInput(paused.publicBuildInputId))!;
  assert.equal(retainedAfterPause.forms[0]!.revision, 2, "The ordinary form transaction must survive alongside provisional media.");
  assert.equal(retainedAfterPause.business.assets.length, 0, "Provisional media must not enter canonical input before finalization.");
  assert.equal((await repository.getBusinessState(input.businessId))!.assets.length, 0, "Provisional media must not alter canonical business state.");

  const checkpoint = await repository.getAgentWorkspaceCheckpoint(paused.resumeCheckpointId!);
  assert(checkpoint, "Needs-input pause did not retain a workspace checkpoint.");
  const sidecarBlob = await store.get(checkpoint.sidecar.key);
  assert(sidecarBlob, "Needs-input checkpoint sidecar is unavailable.");
  const checkpointSidecar = workspaceSourceSidecarSchema.parse(JSON.parse(sidecarBlob.bytes.toString("utf8")));
  assert.equal(checkpointSidecar.sourceHash, checkpoint.workspaceHash);

  // Model an interruption after checkpointing: the resumed workflow receives a
  // completely new sandbox object and must restore from the retained sidecar.
  const checkpointedSession = (await repository.getAgentSession(session.id))!;
  await repository.saveAgentSession(siteAgentSessionSchema.parse({
    ...checkpointedSession,
    status: "checkpointed",
    sandboxId: undefined,
    sandboxDeploymentId: undefined,
    leaseExpiresAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
  const requeued = await firstWorkflow.resumeNeedsInput({
    runId: paused.id,
    sessionId: session.id,
    answer: "Use the existing brand color.",
    actorId: owner
  });
  assert.equal(requeued.status, "queued");
  assert.equal(requeued.provisionalMedia?.contentHash, paused.provisionalMedia?.contentHash);

  const restoredBuildInputs: SitePublicBuildInput[] = [];
  const resumedSandbox = createSandbox({
    store,
    initialFiles,
    restoredFiles: checkpointSidecar.files.map(({ path, content }) => ({ path, content })),
    expectedBackup: checkpoint.backup,
    rebaseInputs: restoredBuildInputs,
    label: "resumed"
  });
  const resumedManager = {
    run: async ({ runtime }: Parameters<WebsiteManagerAgent["run"]>[0]) => {
      resumedManagerCalls += 1;
      const built = await runtime.execute({ callId: "resume_build", name: "build_preview", arguments: {} });
      assert.equal(built.diagnosticOutput.ok, true);
      assert.equal(imageCreatorCalls, 1, "Resume must not call image generation again.");
      throw new ManagerNeedsInputError("Pause after proving the restored preview input.");
    }
  };
  const resumedWorkflow = new SiteAuthoringWorkflow(
    repository, store, resumedSandbox as never, resumedManager as never, undefined, imageCreator as never, deployment
  );
  const pausedAgain = await resumedWorkflow.executeRun(requeued.id);
  assert.equal(pausedAgain.status, "needs_input", pausedAgain.failureReason);
  assert.equal(resumedManagerCalls, 1);
  assert.equal(resumedSandbox.restoreCalls, 1, "A fresh sandbox must restore the retained needs-input workspace.");
  assert.deepEqual(new Set(resumedSandbox.bootstrapInputs[0]!.business.assets.map((asset) => asset.origin)), new Set(["platform_generated", "source_website"]),
    "Fresh bootstrap did not receive projected provisional media before restoring source references.");
  assert.equal(imageCreatorCalls, 1, "Restored generated media must not be regenerated.");
  assert.equal(restoredBuildInputs.length, 1, "Restored provisional media must rebase into the fresh sandbox before preview.");
  assert.deepEqual(new Set(restoredBuildInputs[0]!.business.assets.map((asset) => asset.origin)), new Set(["platform_generated", "source_website"]));
  assert.equal(restoredBuildInputs[0]!.forms[0]!.revision, 2, "Media recovery must preserve the committed form schema.");
  assert.equal(resumedSandbox.appliedFiles.some((file) => file.path === "src/site.tsx" && file.content.includes(paused.provisionalMedia!.refs[0]!.assetId)
    && file.content.includes(paused.provisionalMedia!.refs[1]!.assetId)), true,
  "The fresh sandbox apply did not receive the checkpointed source references.");
  assert.equal((await repository.getBusinessState(input.businessId))!.assets.length, 0, "No media authority is committed until finalization.");

  // Corruption is a fail-closed boundary. The next fresh workflow must reject
  // the stale metadata before its manager or the image creator can run.
  const checkpointedAgain = (await repository.getAgentSession(session.id))!;
  await repository.saveAgentSession(siteAgentSessionSchema.parse({
    ...checkpointedAgain,
    status: "checkpointed",
    sandboxId: undefined,
    sandboxDeploymentId: undefined,
    leaseExpiresAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
  const corruptQueued = await resumedWorkflow.resumeNeedsInput({
    runId: pausedAgain.id,
    sessionId: session.id,
    answer: "Continue the fixture.",
    actorId: owner
  });
  const { contentHash: _priorMediaHash, ...staleScopeDraft } = corruptQueued.provisionalMedia!;
  const staleScopeMedia = {
    ...staleScopeDraft,
    publicBuildInputId: "input_media_recovery_stale_scope"
  };
  const corruptRun = siteAgentRunSchema.parse({
    ...corruptQueued,
    provisionalMedia: {
      ...staleScopeMedia,
      contentHash: sha256(stableJson(staleScopeMedia))
    }
  });
  await repository.saveAgentRun(corruptRun);
  const corruptCheckpoint = await repository.getAgentWorkspaceCheckpoint(corruptRun.resumeCheckpointId!);
  assert(corruptCheckpoint, "Second needs-input pause did not retain a workspace checkpoint.");
  const corruptSidecarBlob = await store.get(corruptCheckpoint.sidecar.key);
  assert(corruptSidecarBlob, "Second checkpoint sidecar is unavailable.");
  const corruptSidecar = workspaceSourceSidecarSchema.parse(JSON.parse(corruptSidecarBlob.bytes.toString("utf8")));
  let corruptionManagerCalls = 0;
  const corruptionSandbox = createSandbox({
    store,
    initialFiles,
    restoredFiles: corruptSidecar.files.map(({ path, content }) => ({ path, content })),
    expectedBackup: corruptCheckpoint.backup,
    label: "corrupt"
  });
  const corruptionWorkflow = new SiteAuthoringWorkflow(
    repository,
    store,
    corruptionSandbox as never,
    { run: async () => { corruptionManagerCalls += 1; } } as never,
    undefined,
    imageCreator as never,
    deployment
  );
  const failed = await corruptionWorkflow.executeRun(corruptRun.id);
  assert.equal(failed.status, "failed");
  assert.match(failed.failureReason ?? "", /provisional_media_recovery_scope_invalid/);
  assert.equal(corruptionManagerCalls, 0, "Stale provisional media reached the resumed model.");
  assert.equal(imageCreatorCalls, 1, "Stale metadata must not cause replacement generation.");

  const canonicalInput = (await repository.getPublicBuildInput(pausedAgain.publicBuildInputId))!;
  await assertInvalidMediaBytes({
    repository,
    store,
    input: canonicalInput,
    deployment,
    owner,
    sourceMedia: pausedAgain.provisionalMedia!,
    suffix: "missing",
    mutate: ({ revisions, refs }) => ({
      revisions: revisions.map((revision, index) => index === 0 ? { ...revision, storageKey: `${revision.storageKey}-missing` } : revision),
      refs: refs.map((ref, index) => index === 0 ? { ...ref, storageKey: `${ref.storageKey}-missing` } : ref)
    }),
    expected: "provisional_media_recovery_bytes_invalid"
  });
  const wrongBytes = Buffer.from("not-the-retained-image");
  const corruptKey = "site-assets/business_synthetic_verification/corrupt-media";
  await store.putImmutable({ key: corruptKey, bytes: wrongBytes, contentType: "image/webp", contentHash: sha256(wrongBytes) });
  await assertInvalidMediaBytes({
    repository,
    store,
    input: canonicalInput,
    deployment,
    owner,
    sourceMedia: pausedAgain.provisionalMedia!,
    suffix: "corrupt",
    mutate: ({ revisions, refs }) => ({
      revisions: revisions.map((revision, index) => index === 0 ? { ...revision, storageKey: corruptKey } : revision),
      refs: refs.map((ref, index) => index === 0 ? { ...ref, storageKey: corruptKey } : ref)
    }),
    expected: "provisional_media_recovery_bytes_invalid"
  });

  const persistenceSession = siteAgentSessionSchema.parse({ ...session, id: "session_media_persistence_failure", publicBuildInputId: canonicalInput.id });
  const persistenceRun = fixtureRun({
    id: "run_media_persistence_failure",
    sessionId: persistenceSession.id,
    siteId: input.siteId,
    publicBuildInputId: canonicalInput.id,
    owner,
    deploymentId: deployment.id
  });
  await repository.saveAgentSession(persistenceSession);
  await repository.saveAgentRun(persistenceRun);
  const failingStore = storageThatRejectsNewMedia(store);
  let persistenceManagerCalls = 0;
  const persistenceWorkflow = new SiteAuthoringWorkflow(
    repository,
    failingStore as never,
    createSandbox({ store, initialFiles, label: "persistence" }) as never,
    { run: async ({ runtime }: Parameters<WebsiteManagerAgent["run"]>[0]) => {
      persistenceManagerCalls += 1;
      const result = await runtime.execute({
        callId: "persistence_failure",
        name: "create_image",
        arguments: {
          action: "generate", purpose: "background", prompt: "Fixture persistence failure.",
          sourceAssetIds: [], size: "1024x1024", alt: "Unavailable fixture image"
        }
      });
      assert.deepEqual(result.diagnosticOutput, { ok: false, error: "generated_media_persistence_failed" });
      assert.equal(result.metering?.usage.outputTokens, 0, "Paid image metering disappeared after persistence failure.");
      throw new ManagerNeedsInputError("Pause after failed media persistence.");
    } } as never,
    undefined,
    imageCreator as never,
    deployment
  );
  const persistencePaused = await persistenceWorkflow.executeRun(persistenceRun.id);
  assert.equal(persistencePaused.status, "needs_input");
  assert.equal(persistenceManagerCalls, 1);
  assert.equal(imageCreatorCalls, 2, "Media persistence failure retried image generation.");
  assert.equal(persistencePaused.provisionalMedia, undefined, "Failed image persistence exposed an asset in recovery metadata.");
  console.log("Interrupted media recovery preserves source references and form authority; stale scope, missing/corrupt bytes, and storage failure fail closed before unsafe resume.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

function fixtureWorkspaceFiles(): WorkspaceSourceFile[] {
  return [
    {
      path: "src/site.tsx",
      content: "export const siteDefinition = { routes: [{ path: '/', element: <main><h1>Northstar</h1></main> }] };"
    },
    { path: "src/styles.css", content: "body { color: #17372e; }" },
    { path: "src/required-destinations.tsx", content: "export const requiredDestinations = [];" }
  ];
}

function createSandbox(input: {
  store: LocalArtifactBlobStore;
  initialFiles: WorkspaceSourceFile[];
  restoredFiles?: WorkspaceSourceFile[];
  expectedBackup?: { id: string; key: string; contentHash: string; bytes: number };
  rebaseInputs?: SitePublicBuildInput[];
  label: string;
}) {
  let files = cloneFiles(input.initialFiles);
  let revision = `${input.label}_bootstrap`;
  let currentInput: SitePublicBuildInput | undefined;
  let backupSequence = 0;
  const sandbox = {
    restoreCalls: 0,
    bootstrapInputs: [] as SitePublicBuildInput[],
    appliedFiles: [] as WorkspaceSourceFile[],
    bootstrap: async (_sandboxId: string, buildInput: SitePublicBuildInput) => {
      files = cloneFiles(input.initialFiles);
      revision = `${input.label}_bootstrap`;
      currentInput = buildInput;
      sandbox.bootstrapInputs.push(buildInput);
      return { ok: true as const, revision };
    },
    diagnostics: async () => ({ ok: true as const, revision, sandboxManifest: expectedSiteSandboxManifest }),
    getSource: async () => ({ ok: true as const, revision, files: cloneFiles(files) }),
    backup: async () => {
      const id = sha256(`${input.label}:backup:${++backupSequence}`).slice("sha256:".length);
      const key = `workspace-backups/${id}.tar.gz`;
      const bytes = Buffer.from(stableJson(files));
      const contentHash = sha256(bytes);
      await input.store.putImmutable({ key, bytes, contentType: "application/gzip", contentHash });
      return {
        ok: true as const,
        backup: { id, revision, size: bytes.length, key, contentHash }
      };
    },
    restore: async (_sandboxId: string, backupId: string, _expectedRevision: string, archiveHash: string) => {
      assert(input.restoredFiles, "Fresh recovery sandbox received no retained checkpoint files.");
      assert.equal(backupId, input.expectedBackup?.id);
      assert.equal(archiveHash, input.expectedBackup?.contentHash);
      const restoredAssetIds = input.restoredFiles.flatMap((file) =>
        [...file.content.matchAll(/<Asset\s+id="([^"]+)"/g)].map((match) => match[1]!));
      for (const assetId of restoredAssetIds) {
        assert(currentInput?.business.assets.some((asset) => asset.assetId === assetId),
          `restore_unknown_eligible_asset:${assetId}`);
      }
      sandbox.restoreCalls += 1;
      files = cloneFiles(input.restoredFiles);
      revision = `${input.label}_restored`;
      return { ok: true as const, revision, buildDurationMs: 1, previewPath: "/" };
    },
    rebase: async (_sandboxId: string, _expectedRevision: string, buildInput: SitePublicBuildInput) => {
      input.rebaseInputs?.push(buildInput);
      currentInput = buildInput;
      revision = `${input.label}_rebased`;
      return { ok: true as const, revision, buildDurationMs: 1, previewPath: "/" };
    },
    apply: async (_sandboxId: string, _expectedRevision: string, nextFiles: WorkspaceSourceFile[]) => {
      files = cloneFiles(nextFiles);
      sandbox.appliedFiles = cloneFiles(nextFiles);
      revision = `${input.label}_applied`;
      return { ok: true as const, revision, buildDurationMs: 1, previewPath: "/" };
    },
    destroy: async () => ({ ok: true as const })
  };
  return sandbox;
}

function cloneFiles(files: WorkspaceSourceFile[]) {
  return files.map((file) => ({ ...file }));
}

async function assertInvalidMediaBytes(input: {
  repository: LocalSitePlatformRepository;
  store: LocalArtifactBlobStore;
  input: SitePublicBuildInput;
  deployment: ReturnType<typeof siteSandboxDeploymentSchema.parse>;
  owner: string;
  sourceMedia: NonNullable<ReturnType<typeof siteAgentRunSchema.parse>["provisionalMedia"]>;
  suffix: string;
  mutate: (media: {
    revisions: NonNullable<ReturnType<typeof siteAgentRunSchema.parse>["provisionalMedia"]>["revisions"];
    refs: NonNullable<ReturnType<typeof siteAgentRunSchema.parse>["provisionalMedia"]>["refs"];
  }) => { revisions: NonNullable<ReturnType<typeof siteAgentRunSchema.parse>["provisionalMedia"]>["revisions"]; refs: NonNullable<ReturnType<typeof siteAgentRunSchema.parse>["provisionalMedia"]>["refs"] };
  expected: string;
}) {
  const session = siteAgentSessionSchema.parse({
    schemaVersion: "site-agent-session",
    id: `session_media_${input.suffix}`,
    siteId: input.input.siteId,
    principal: { kind: "owner", id: input.owner },
    status: "active",
    publicBuildInputId: input.input.id,
    sandboxProvider: "cloudflare",
    leaseTokenHash: sha256(`media-${input.suffix}`),
    leaseExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    rotateAt: new Date(Date.now() + 7_200_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  const run = fixtureRun({
    id: `run_media_${input.suffix}`,
    sessionId: session.id,
    siteId: input.input.siteId,
    publicBuildInputId: input.input.id,
    owner: input.owner,
    deploymentId: input.deployment.id
  });
  const changed = input.mutate({ revisions: input.sourceMedia.revisions, refs: input.sourceMedia.refs });
  const draft = {
    ...input.sourceMedia,
    runId: run.id,
    siteId: run.siteId,
    publicBuildInputId: input.input.id,
    inputHash: input.input.inputHash,
    parentRevisionId: run.exactParentRevisionId,
    revisions: changed.revisions,
    refs: changed.refs,
    executionNumber: run.executionNumber
  };
  const { contentHash: _oldHash, ...withoutHash } = draft;
  await input.repository.saveAgentSession(session);
  await input.repository.saveAgentRun(siteAgentRunSchema.parse({
    ...run,
    provisionalMedia: { ...withoutHash, contentHash: sha256(stableJson(withoutHash)) }
  }));
  let managerCalls = 0;
  const workflow = new SiteAuthoringWorkflow(
    input.repository,
    input.store,
    createSandbox({ store: input.store, initialFiles: fixtureWorkspaceFiles(), label: `invalid-${input.suffix}` }) as never,
    { run: async () => { managerCalls += 1; } } as never,
    undefined,
    undefined,
    input.deployment
  );
  const failed = await workflow.executeRun(run.id);
  assert.equal(failed.status, "failed");
  assert.match(failed.failureReason ?? "", new RegExp(input.expected));
  assert.equal(managerCalls, 0, `${input.suffix} media bytes reached the manager.`);
}

function fixtureRun(input: {
  id: string;
  sessionId: string;
  siteId: string;
  publicBuildInputId: string;
  owner: string;
  deploymentId: string;
}) {
  const now = new Date().toISOString();
  return siteAgentRunSchema.parse({
    schemaVersion: "site-agent-run",
    id: input.id,
    sessionId: input.sessionId,
    siteId: input.siteId,
    publicBuildInputId: input.publicBuildInputId,
    request: { kind: "owner_instruction", messageIds: [`message_${input.id}`] },
    origin: "owner_request",
    requestedBy: input.owner,
    kind: "initial_build",
    status: "queued",
    stage: "architecting",
    executionNumber: 1,
    sandboxDeploymentId: input.deploymentId,
    apiProvider: "openai",
    modelId: "gpt-5.6-sol",
    skillVersions: {},
    guardrails: siteAgentRunGuardrailsForKind("initial_build", now),
    usage: {
      inputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, outputTokens: 0,
      costUsd: 0, costSource: "unavailable", upstreamInferenceCostUsd: 0, durationMs: 0
    },
    startedAt: now
  });
}

function storageThatRejectsNewMedia(store: LocalArtifactBlobStore) {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "putImmutable") {
        return async (value: { key: string }) => {
          if (value.key.startsWith("site-assets/")) throw new Error("fixture_media_store_unavailable");
          return target.putImmutable(value as never);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
