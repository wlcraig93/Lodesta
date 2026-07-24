import { randomBytes, randomUUID } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { getSiteAuthoringModelSettings } from "@/lib/operator-settings";
import { createPublicBuildInput, assertNoPrivateBuildInputFields, ingestWebsite, sha256, stableJson } from "@/packages/business-data";
import { sitePlatformRepository, type SitePlatformRepository } from "@/packages/platform-data";
import {
  configuredArtifactBlobStore,
  persistFinalArtifact,
  serializeWorkspaceSourceSidecar,
  workspaceSourceSidecarKey,
  workspaceSourceSidecarSchema,
  type ArtifactBlobStore,
  type WorkspaceSourceSidecar
} from "@/packages/site-artifacts";
import {
  classifySiteAuthoringFailure,
  createImageBytes,
  createAuthoringContextPacket,
  isSiteAuthoringTerminalError,
  managerLimitsForKind,
  ManagerNeedsInputError,
  SiteAuthoringTerminalError,
  WebsiteManagerAgent,
  taskSkillFor,
  websiteManagerPromptIdentity,
  workspaceSourceFileSchema,
  workspaceSourcePolicyIdentity,
  type ManagerToolExecution,
  type ManagerToolName,
  type ManagerRunRequest,
  type CreateImageRequest,
  type WorkspaceSourceFile
} from "@/packages/site-agent";
import {
  configuredSiteSandboxClient,
  SiteSandboxArtifactContractError,
  SiteSandboxRequestError,
  type SiteSandboxClient
} from "@/packages/site-sandbox";
import {
  siteAuthoringPlatformIdentity,
  operatorQueueItemSchema,
  assetRevisionSchema,
  businessStateSchema,
  siteAgentRunSchema,
  siteAgentApiProviderSchema,
  siteAgentSessionSchema,
  platformSiteRecordSchema,
  siteVersionSchema,
  siteWorkspaceRevisionSchema,
  verticalDemandEventSchema,
  type SiteAgentRun,
  type AssetRevision,
  type AssetRevisionRef,
  type BusinessState,
  type SiteAgentPrincipal,
  type SiteAgentSession,
  type SiteBuildArtifact,
  type SiteElementSelection,
  type PlatformSiteRecord,
  type SitePublicBuildInput,
  type SiteVersion,
  type SiteWorkspaceRevision
} from "@/packages/site-contracts";
import {
  expectedSiteSandboxManifest,
  sandboxImageDigest,
  siteToolchainIdentity,
  siteVerificationPolicyIdentity
} from "@/packages/site-contracts/platform-manifest";
import {
  finalizePreparedArtifact,
  createArtifactContactSheet,
  createMediaContactSheet,
  createArtifactThumbnail,
  logThumbnailFailure,
  prepareSiteArtifact,
  runArtifactBrowserGate
} from "@/packages/site-verification";
import { createSiteRuntimePatch } from "@/packages/trusted-runtime";
import {
  draftPreviewGrant,
  platformOperationsRepository,
  type PlatformOperationsRepository
} from "@/packages/platform-operations";
import {
  WorkspaceManagerRuntime,
  type RuntimeInspection,
  type WorkspaceManagerRuntimeSnapshot
} from "./manager-runtime";
import { deriveSitePublicationReadiness } from "./publication-readiness";
import { SiteAgentEventRecorder } from "./run-events";
import { normalizeBootstrapSourceUrl } from "./source-url";
import { sendOwnerOperationalEmail } from "@/lib/owner-notifications";
import {
  authoringExecutionBundleSchema,
  authoringOutboxEventSchema,
  externalAuthoringExecutionSchema,
  stagedBlobReceiptSchema
} from "@/packages/external-authoring/contracts";
import { externalAuthoringRepository } from "@/packages/external-authoring/repository";

const runtimeSeriesId = "site-runtime-v1";
export { siteAuthoringPlatformIdentity, siteToolchainIdentity };
const idleLeaseMs = 10 * 60_000;
const rotationMs = 2 * 60 * 60_000;
export const initialGenerationDeadlineMs = 60 * 60_000;
export const siteEditDeadlineMs = 25 * 60_000;

export class SiteAuthoringWorkflow {
  constructor(
    private readonly repository: SitePlatformRepository = sitePlatformRepository,
    private readonly blobStore: ArtifactBlobStore = lazyExternalClient(configuredArtifactBlobStore),
    private readonly sandbox: SiteSandboxClient = lazyExternalClient(configuredSiteSandboxClient),
    private readonly manager = new WebsiteManagerAgent(),
    private readonly operationsRepository: PlatformOperationsRepository = platformOperationsRepository,
    private readonly imageCreator: typeof createImageBytes = createImageBytes
  ) {}

  async bootstrapFromUrl(input: {
    url: string;
    ownerId: string;
    reportingTimezone?: string;
    slug?: string;
    signal?: AbortSignal;
  }) {
    const workflowStartedAt = new Date().toISOString();
    const workflowSignal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(initialGenerationDeadlineMs)])
      : AbortSignal.timeout(initialGenerationDeadlineMs);
    const ingested = await ingestWebsite({
      url: input.url,
      slug: input.slug,
      signal: workflowSignal
    });
    if (!ingested.domainContext) {
      await this.repository.saveVerticalDemandEvent(verticalDemandEventSchema.parse({
        schemaVersion: "vertical-demand-event",
        id: id("vertical_demand"),
        sourceUrl: input.url,
        observedVertical: ingested.state.identity.categories[0],
        requestedBy: input.ownerId,
        status: "open",
        createdAt: new Date().toISOString()
      }));
    }
    const buildInput = createPublicBuildInput({
      id: id("input"),
      state: ingested.state,
      intent: ingested.intent,
      forms: ingested.forms,
      domainContext: ingested.domainContext,
      sourceSnapshotIds: ingested.sourceSnapshots.map((source) => source.id),
      runtimeSeriesId
    });
    assertNoPrivateBuildInputFields(buildInput);
    for (const asset of ingested.retainedAssets) {
      await this.blobStore.putImmutable({
        key: asset.revision.storageKey,
        bytes: asset.bytes,
        contentType: asset.revision.mimeType,
        contentHash: asContentHash(asset.revision.contentHash)
      });
    }
    const site = {
      ...ingested.site,
      sourceUrl: input.url,
      normalizedSource: normalizeBootstrapSourceUrl(input.url),
      reportingTimezone: input.reportingTimezone ?? "UTC"
    };
    const persistedSite = await this.bootstrapWithUniqueSlug({
      site,
      state: ingested.state,
      intent: ingested.intent,
      forms: ingested.forms,
      sourceSnapshots: ingested.sourceSnapshots,
      assetRevisions: ingested.retainedAssets.map((asset) => asset.revision),
      publicBuildInput: buildInput
    });
    await this.ensureRuntime();
    const session = await this.getOrCreateSession({ siteId: persistedSite.id, principal: { kind: "owner", id: input.ownerId }, buildInput });
    let run = await this.enqueueRun({
      session,
      kind: "initial_build",
      instruction: "Create the complete initial customer website from the canonical public business input.",
      requestedBy: input.ownerId,
      workflowStartedAt
    });
    if (ingested.researchUsage) {
      run = await this.updateRun(run, {
        modelId: ingested.researchUsage.modelId,
        usage: {
          kind: "model_reported",
          inputTokens: ingested.researchUsage.inputTokens,
          cachedInputTokens: ingested.researchUsage.cachedInputTokens,
          reasoningTokens: 0,
          outputTokens: ingested.researchUsage.outputTokens,
          costUsd: ingested.researchUsage.estimatedCostUsd,
          costSource: "catalog_estimate",
          upstreamInferenceCostUsd: 0,
          durationMs: ingested.researchUsage.durationMs
        }
      });
    }
    return { site: persistedSite, session, run, buildInput };
  }

  async prepareExternalSite(input: {
    url: string;
    operatorId: string;
    batchItemId: string;
    preparationKey: `sha256:${string}`;
    signal?: AbortSignal;
  }) {
    const now = new Date().toISOString();
    const siteId = deterministicId("site", { schemaVersion: 1, preparationKey: input.preparationKey });
    const businessId = deterministicId("business", { schemaVersion: 1, preparationKey: input.preparationKey });
    const publicBuildInputId = deterministicId("input", { schemaVersion: 1, preparationKey: input.preparationKey });
    const retainedSite = await this.repository.getSite(siteId);
    const prepared = retainedSite
      ? await (async () => {
          if (
            retainedSite.businessId !== businessId
            || retainedSite.normalizedSource !== normalizeBootstrapSourceUrl(input.url)
            || retainedSite.currentPublicBuildInputId !== publicBuildInputId
          ) {
            throw new Error("External preparation idempotency conflict.");
          }
          const [state, buildInput] = await Promise.all([
            this.repository.getBusinessState(businessId),
            this.repository.getPublicBuildInput(publicBuildInputId)
          ]);
          if (!state || !buildInput || buildInput.siteId !== retainedSite.id || buildInput.businessId !== businessId) {
            throw new Error("Retained external preparation is incomplete.");
          }
          return { site: retainedSite, state, buildInput };
        })()
      : await (async () => {
          const ingested = await ingestWebsite({
            url: input.url,
            siteId,
            businessId,
            signal: input.signal,
            researchMode: "disabled"
          });
          const buildInput = createPublicBuildInput({
            id: publicBuildInputId,
            state: ingested.state,
            intent: ingested.intent,
            forms: ingested.forms,
            domainContext: ingested.domainContext,
            sourceSnapshotIds: ingested.sourceSnapshots.map((source) => source.id),
            runtimeSeriesId
          });
          assertNoPrivateBuildInputFields(buildInput);
          for (const asset of ingested.retainedAssets) {
            await this.blobStore.putImmutable({
              key: asset.revision.storageKey,
              bytes: asset.bytes,
              contentType: asset.revision.mimeType,
              contentHash: asContentHash(asset.revision.contentHash)
            });
          }
          const site = await this.bootstrapWithUniqueSlug({
            site: {
              ...ingested.site,
              sourceUrl: input.url,
              normalizedSource: normalizeBootstrapSourceUrl(input.url)
            },
            state: ingested.state,
            intent: ingested.intent,
            forms: ingested.forms,
            sourceSnapshots: ingested.sourceSnapshots,
            assetRevisions: ingested.retainedAssets.map((asset) => asset.revision),
            publicBuildInput: buildInput
          });
          return { site, state: ingested.state, buildInput };
        })();
    const { site: persistedSite, state: preparedState, buildInput } = prepared;
    await this.ensureRuntime();
    const session = await this.getOrCreateSession({
      siteId: persistedSite.id,
      principal: { kind: "operator", id: input.operatorId },
      buildInput
    });
    const instruction = "Create the complete prospect-preview website from the canonical public business input. This is an unowned sales preview; do not publish it or imply customer approval.";
    const runId = deterministicId("run", { schemaVersion: 1, preparationKey: input.preparationKey });
    const bundleId = deterministicId("bundle", { schemaVersion: 1, runId });
    const proposedRun = siteAgentRunSchema.parse({
      schemaVersion: "site-agent-run",
      id: runId,
      sessionId: session.id,
      siteId: persistedSite.id,
      publicBuildInputId: buildInput.id,
      origin: "external_batch",
      executionDriver: "external_mcp",
      externalProvenance: {
        clientAuthExpectation: "chatgpt",
        clientAuthVerification: "operator_configured",
        skillContractExpectation: "lodesta-operator-authoring@sha256:385de911c209d7a7d24f585866fcb710f1d27d6cd2aa8d7033fa2812326422cf",
        skillContractVerification: "operator_configured",
        modelUsage: "unavailable"
      },
      authoringExecutionBundleId: bundleId,
      requestedBy: input.operatorId,
      publishAfterSuccess: false,
      kind: "initial_build",
      status: "queued",
      stage: "queued",
      executionNumber: 0,
      skillVersions: {
        manager: websiteManagerPromptIdentity,
        domainContext: buildInput.domainContext?.version ?? "none",
        [taskSkillFor("initial_build").id]: taskSkillFor("initial_build").identity
      },
      limits: managerLimitsForKind("initial_build"),
      usage: {
        kind: "external_unavailable",
        modelUsage: "unavailable",
        sandboxDurationMs: 0,
        browserDurationMs: 0,
        storageBytes: 0,
        durationMs: 0
      },
      startedAt: now
    });
    const retainedRun = await this.repository.getAgentRun(runId);
    let run = retainedRun;
    if (run) {
      if (
        run.siteId !== persistedSite.id
        || run.sessionId !== session.id
        || run.publicBuildInputId !== buildInput.id
        || run.executionDriver !== "external_mcp"
      ) {
        throw new Error("External preparation run idempotency conflict.");
      }
    } else {
      try {
        run = await this.repository.enqueueAgentRun(proposedRun);
      } catch (error) {
        run = await this.repository.getAgentRun(runId);
        if (!run) throw error;
      }
    }
    const operatorMessage = {
      schemaVersion: "site-agent-message",
      id: deterministicId("message", { schemaVersion: 1, runId, role: "operator" }),
      sessionId: session.id,
      runId,
      role: "operator",
      content: instruction,
      createdAt: now
    } as const;
    const retainedMessages = await this.repository.listAgentMessages(session.id);
    if (!retainedMessages.some((message) => message.id === operatorMessage.id)) {
      try {
        await this.repository.appendAgentMessage(operatorMessage);
      } catch (error) {
        const afterLostResponse = await this.repository.listAgentMessages(session.id);
        if (!afterLostResponse.some((message) => message.id === operatorMessage.id)) throw error;
      }
    }
    const taskSkill = taskSkillFor("initial_build");
    const bundleSeed = {
      schemaVersion: 1,
      runId,
      instructionVersion: "external-prospect-initial@sha256:2efb91f90026d0fafd1c839a8d613d34571a3b187d7d0a382cf51582bb0f055d",
      instructionHash: sha256(instruction),
      skillContractVersion: taskSkill.identity,
      skillContractHash: sha256(stableJson(taskSkill)),
      publicBuildInputId: buildInput.id,
      publicBuildInputHash: buildInput.inputHash,
      sourcePolicyVersion: workspaceSourcePolicyIdentity,
      sourcePolicyHash: sha256(stableJson({ identity: workspaceSourcePolicyIdentity, manifest: expectedSiteSandboxManifest })),
      verificationPolicyVersion: siteVerificationPolicyIdentity,
      verificationPolicyHash: sha256(stableJson({ identity: siteVerificationPolicyIdentity })),
      toolSchemaHash: sha256(stableJson({
        identity: "manager-tool-contract@sha256:b20ca6b1645658edd47da28dd3172d1f128f885b38f3542dbbd3500a016c392d",
        tools: ["list_files", "read_file", "write_file", "delete_file", "apply_patch", "build_preview", "inspect_site", "request_input", "finish"]
      })),
      toolchainVersion: siteToolchainIdentity,
      sandboxImageDigest: configuredSandboxImageDigest()
    };
    const proposedBundle = authoringExecutionBundleSchema.parse({
      ...bundleSeed,
      id: bundleId,
      bundleHash: sha256(stableJson(bundleSeed)),
      createdAt: now
    });
    const executionId = deterministicId("execution", { schemaVersion: 1, runId });
    const proposedExecution = externalAuthoringExecutionSchema.parse({
      schemaVersion: 1,
      id: executionId,
      runId,
      batchItemId: input.batchItemId,
      bundleId,
      status: "queued",
      stateRevision: 0,
      createdAt: now,
      updatedAt: now
    });
    const retainedBundle = await externalAuthoringRepository.getBundle(bundleId);
    const bundle = retainedBundle ?? proposedBundle;
    if (retainedBundle && retainedBundle.bundleHash !== proposedBundle.bundleHash) {
      throw new Error("External preparation bundle idempotency conflict.");
    }
    if (!retainedBundle) await externalAuthoringRepository.saveBundle(bundle);
    const retainedExecution = await externalAuthoringRepository.getExecution(executionId);
    const execution = retainedExecution ?? proposedExecution;
    if (
      retainedExecution
      && (
        retainedExecution.runId !== run.id
        || retainedExecution.batchItemId !== input.batchItemId
        || retainedExecution.bundleId !== bundle.id
      )
    ) {
      throw new Error("External preparation execution idempotency conflict.");
    }
    if (!retainedExecution) await externalAuthoringRepository.saveExecution(execution);
    return {
      site: persistedSite,
      state: preparedState,
      session,
      run,
      buildInput,
      bundle,
      execution
    };
  }

  async executeExternalTool(input: {
    executionId: string;
    operationId: string;
    toolName: ManagerToolName;
    arguments: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<{
    execution: NonNullable<Awaited<ReturnType<typeof externalAuthoringRepository.getExecution>>>;
    tool: ManagerToolExecution;
    workspaceHash?: `sha256:${string}`;
    checkpoint: { key: string; contentHash: `sha256:${string}`; bytes: number; receiptId: string };
    finalization?: {
      finalizationKey: `sha256:${string}`;
      revision: SiteWorkspaceRevision;
      artifact: SiteBuildArtifact;
      version: SiteVersion;
      run: SiteAgentRun;
      session: SiteAgentSession;
      previewGrant: ReturnType<typeof draftPreviewGrant>;
      outbox: ReturnType<typeof candidateOutbox>;
      receiptIds: string[];
    };
  }> {
    const execution = await externalAuthoringRepository.getExecution(input.executionId);
    if (!execution?.bundleId) throw new Error("External execution is unavailable or unpinned.");
    const [bundle, run] = await Promise.all([
      externalAuthoringRepository.getBundle(execution.bundleId),
      this.repository.getAgentRun(execution.runId)
    ]);
    if (!bundle || !run || run.executionDriver !== "external_mcp") throw new Error("External authoring bundle or run is unavailable.");
    const [session, buildInput] = await Promise.all([
      this.repository.getAgentSession(run.sessionId),
      this.repository.getPublicBuildInput(bundle.publicBuildInputId)
    ]);
    if (!session || !buildInput) throw new Error("External authoring session or public input is unavailable.");
    if (
      buildInput.inputHash !== bundle.publicBuildInputHash
      || bundle.sourcePolicyVersion !== workspaceSourcePolicyIdentity
      || bundle.verificationPolicyVersion !== siteVerificationPolicyIdentity
      || bundle.toolchainVersion !== siteToolchainIdentity
      || bundle.sandboxImageDigest !== configuredSandboxImageDigest()
    ) {
      throw new Error("execution_bundle_stale_restart_required");
    }

    type RevisionDraft = Omit<SiteWorkspaceRevision, "sourceArchiveKey">;
    type Checkpoint = Awaited<ReturnType<SiteAuthoringWorkflow["verifySandboxArtifact"]>> & { revisionDraft: RevisionDraft };
    let snapshot: WorkspaceManagerRuntimeSnapshot<Checkpoint> | undefined;
    if (execution.checkpointKey) {
      const retained = await this.blobStore.get(execution.checkpointKey);
      if (!retained || retained.contentHash !== execution.checkpointHash) throw new Error("External authoring checkpoint is unavailable.");
      snapshot = deserialize(retained.bytes) as WorkspaceManagerRuntimeSnapshot<Checkpoint>;
      if (snapshot.schemaVersion !== 1) throw new Error("External authoring checkpoint schema is unsupported.");
    }
    let activeSession = session;
    let activeSandboxRevision = snapshot?.sandboxRevision ?? "deferred";
    const ensureBuildSandbox = async () => {
      if (activeSession.sandboxId && activeSandboxRevision !== "deferred") return;
      const state = await this.ensureSandbox(activeSession, buildInput);
      activeSession = state.session;
      activeSandboxRevision = state.revision;
    };
    const runtime = new WorkspaceManagerRuntime<Checkpoint>({
      kind: run.kind,
      publicBuildInputId: buildInput.id,
      toolchainVersion: siteToolchainIdentity,
      sandboxImageDigest: configuredSandboxImageDigest(),
      initialFiles: snapshot ? undefined : run.kind === "initial_build" ? undefined : await this.loadWorkspaceSource(run.exactParentRevisionId),
      initialSandboxRevision: activeSandboxRevision,
      initialSnapshot: snapshot,
      applyBuild: async (files) => {
        await ensureBuildSandbox();
        const started = Date.now();
        const applied = await this.sandbox.apply(activeSession.sandboxId!, activeSandboxRevision, files);
        activeSandboxRevision = applied.revision;
        return {
          ...applied,
          buildDurationMs: applied.buildDurationMs ?? Date.now() - started,
          previewPath: `/api/operator/external-authoring/executions/${encodeURIComponent(execution.id)}/preview`
        };
      },
      retainDiagnostic: async (kind, content) => {
        const bytes = Buffer.from(content);
        const contentHash = sha256(bytes);
        const key = `external-authoring/diagnostics/${execution.id}/${kind}-${contentHash.slice("sha256:".length)}.txt`;
        await this.blobStore.putImmutable({ key, bytes, contentType: "text/plain; charset=utf-8", contentHash });
        return { key, contentHash, bytes: bytes.length };
      },
      inspect: async (files, sandboxRevision): Promise<RuntimeInspection<Checkpoint>> => {
        const site = await this.repository.getSite(run.siteId);
        if (!site) throw new Error("Site not found.");
        const parent = site.currentWorkspaceRevisionId ? await this.repository.getWorkspaceRevision(site.currentWorkspaceRevisionId) : undefined;
        const sourceHash = sha256(stableJson(files));
        const workspaceRevisionId = deterministicId("workspace_revision", {
          schemaVersion: 1,
          runId: run.id,
          siteId: run.siteId,
          parentRevisionId: site.currentWorkspaceRevisionId ?? null,
          sourceHash
        });
        const finalized = await this.verifySandboxArtifact({
          run,
          session: activeSession,
          buildInput,
          workspaceRevisionId,
          signal: input.signal
        });
        const errors = finalized.artifact.qa.findings.filter((finding) => finding.severity === "error");
        const warnings = finalized.artifact.qa.findings.filter((finding) => finding.severity === "warning");
        const runtimePatch = await this.repository.getRuntimePatch(finalized.artifact.runtimePatchAtFinalization);
        if (!runtimePatch) throw new Error("Finalized runtime patch is unavailable.");
        const inspectionHash = sha256(stableJson({
          schemaVersion: 1,
          workspaceHash: sourceHash,
          publicBuildInputHash: buildInput.inputHash,
          verificationPolicyVersion: siteVerificationPolicyIdentity,
          sourcePolicyVersion: workspaceSourcePolicyIdentity,
          toolchainVersion: siteToolchainIdentity,
          sandboxImageDigest: configuredSandboxImageDigest(),
          runtimePatchHash: runtimePatch.contentHash,
          artifactContentHash: semanticArtifactContentHash(finalized.artifact),
          hardGate: finalized.artifact.qa.hardGate,
          findings: normalizedInspectionFindings(finalized.artifact.qa.findings),
          captures: finalized.browserCaptures
            .map((capture) => ({ route: capture.route, viewport: capture.viewport, contentHash: sha256(capture.bytes) }))
            .sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
        }));
        const checkpoint = finalized.artifact.qa.hardGate === "passed" ? {
          ...finalized,
          revisionDraft: {
            schemaVersion: 1 as const,
            id: workspaceRevisionId,
            siteId: run.siteId,
            parentRevisionId: site.currentWorkspaceRevisionId,
            revisionNumber: (parent?.revisionNumber ?? 0) + 1,
            sourceHash,
            files: files.map((file) => ({
              path: file.path,
              contentHash: sha256(file.content),
              bytes: Buffer.byteLength(file.content)
            })),
            createdAt: new Date().toISOString(),
            createdBy: { kind: "agent" as const, id: run.id }
          }
        } : undefined;
        return {
          passed: finalized.artifact.qa.hardGate === "passed",
          inspectionHash,
          modelSummary: {
            ok: finalized.artifact.qa.hardGate === "passed",
            workspaceHash: sourceHash,
            sandboxRevision,
            publicBuildInputId: buildInput.id,
            toolchainVersion: siteToolchainIdentity,
            inspectionHash,
            routes: finalized.artifact.routes,
            findingCount: finalized.artifact.qa.findings.length,
            blockerCount: errors.length,
            advisoryCount: warnings.length,
            blockers: errors.slice(0, 100),
            advisories: warnings.slice(0, 8)
          },
          diagnosticSummary: {
            ok: finalized.artifact.qa.hardGate === "passed",
            workspaceHash: sourceHash,
            sandboxRevision,
            inspectionHash,
            artifactHash: finalized.artifact.artifactHash,
            findingCount: finalized.artifact.qa.findings.length,
            errorCount: errors.length,
            warningCount: warnings.length,
            screenshotKeys: finalized.artifact.qa.screenshotKeys
          },
          images: finalized.contactSheet ? [{
            type: "input_image",
            image_url: `data:image/png;base64,${finalized.contactSheet.toString("base64")}`,
            detail: "high"
          }] : undefined,
          checkpoint
        };
      }
    });
    const tool = await runtime.execute({
      callId: input.operationId,
      name: input.toolName,
      arguments: input.arguments
    });
    const runtimeSnapshot = runtime.snapshot();
    const serialized = serialize(runtimeSnapshot);
    const contentHash = sha256(serialized);
    const key = `external-authoring/checkpoints/${execution.id}/${input.operationId}-${contentHash.slice("sha256:".length)}.bin`;
    await this.blobStore.putImmutable({
      key,
      bytes: serialized,
      contentType: "application/vnd.lodesta.external-authoring-checkpoint",
      contentHash
    });
    const retained = await this.blobStore.get(key);
    if (!retained || retained.contentHash !== contentHash) throw new Error("External authoring checkpoint verification failed.");
    const receiptId = deterministicId("blob_receipt", { schemaVersion: 1, key, contentHash });
    await externalAuthoringRepository.saveStagedBlobReceipt(stagedBlobReceiptSchema.parse({
      schemaVersion: 1,
      id: receiptId,
      storageKey: key,
      contentHash,
      bytes: serialized.length,
      etag: contentHash,
      stagedAt: new Date().toISOString()
    }));

    let finalization: {
      finalizationKey: `sha256:${string}`;
      revision: SiteWorkspaceRevision;
      artifact: SiteBuildArtifact;
      version: SiteVersion;
      run: SiteAgentRun;
      session: SiteAgentSession;
      previewGrant: ReturnType<typeof draftPreviewGrant>;
      outbox: ReturnType<typeof candidateOutbox>;
      receiptIds: string[];
    } | undefined;
    if (tool.completion) {
      const checkpoint = runtime.finalCheckpoint();
      await ensureBuildSandbox();
      const backup = await this.sandbox.backup(activeSession.sandboxId!);
      const revision = siteWorkspaceRevisionSchema.parse({
        ...checkpoint.revisionDraft,
        sourceArchiveKey: backup.backup.key
      });
      await this.persistVerificationCaptures(checkpoint);
      const sourceSidecar = await this.persistWorkspaceSourceSidecar(revision, runtime.currentFiles(), backup.backup);
      await persistFinalArtifact({ artifact: checkpoint.artifact, files: checkpoint.files, store: this.blobStore });
      const candidate = await this.createCandidateDraft(
        checkpoint.artifact,
        revision.id,
        buildInput,
        run,
        tool.completion.inspectionHash
      );
      const finalizationManifestBytes = Buffer.from(stableJson({
        schemaVersion: 1,
        finalizationKey: candidate.finalizationKey,
        checkpoint: { key, contentHash, bytes: serialized.length },
        workspaceArchive: {
          key: backup.backup.key,
          contentHash: backup.backup.contentHash,
          bytes: backup.backup.size
        },
        workspaceSourceSidecar: sourceSidecar,
        artifact: {
          id: checkpoint.artifact.id,
          artifactHash: checkpoint.artifact.artifactHash,
          files: checkpoint.artifact.files.map((file) => ({
            storageKey: file.storageKey,
            contentHash: file.contentHash,
            bytes: file.bytes
          }))
        },
        captures: [
          ...checkpoint.browserCaptures.map((capture) => ({
            storageKey: capture.key,
            contentHash: sha256(capture.bytes),
            bytes: capture.bytes.length
          })),
          {
            storageKey: checkpoint.contactSheetKey,
            contentHash: sha256(checkpoint.contactSheet),
            bytes: checkpoint.contactSheet.length
          }
        ]
      }));
      const finalizationManifestHash = sha256(finalizationManifestBytes);
      const finalizationManifestKey = `external-authoring/finalizations/${candidate.finalizationKey.slice("sha256:".length)}.json`;
      await this.blobStore.putImmutable({
        key: finalizationManifestKey,
        bytes: finalizationManifestBytes,
        contentType: "application/json; charset=utf-8",
        contentHash: finalizationManifestHash
      });
      const retainedManifest = await this.blobStore.get(finalizationManifestKey);
      if (!retainedManifest || retainedManifest.contentHash !== finalizationManifestHash) {
        throw new Error("External authoring finalization manifest verification failed.");
      }
      const finalizationReceiptId = deterministicId("blob_receipt", {
        schemaVersion: 1,
        key: finalizationManifestKey,
        contentHash: finalizationManifestHash
      });
      await externalAuthoringRepository.saveStagedBlobReceipt(stagedBlobReceiptSchema.parse({
        schemaVersion: 1,
        id: finalizationReceiptId,
        storageKey: finalizationManifestKey,
        contentHash: finalizationManifestHash,
        bytes: finalizationManifestBytes.length,
        etag: finalizationManifestHash,
        finalizationKey: candidate.finalizationKey,
        stagedAt: new Date().toISOString()
      }));
      const completedAt = new Date().toISOString();
      const completedRun = siteAgentRunSchema.parse({
        ...run,
        status: "succeeded",
        stage: "candidate_ready",
        outputRevisionId: revision.id,
        outputArtifactId: checkpoint.artifact.id,
        screenshotKeys: checkpoint.artifact.qa.screenshotKeys,
        candidateVersionId: candidate.version.id,
        completedAt
      });
      const completedSession = siteAgentSessionSchema.parse({
        ...activeSession,
        status: "active",
        currentWorkspaceRevisionId: revision.id,
        leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(),
        updatedAt: completedAt
      });
      const previewGrant = draftPreviewGrant({
        previewId: deterministicId("preview", { schemaVersion: 1, finalizationKey: candidate.finalizationKey }),
        siteId: run.siteId,
        siteVersionId: candidate.version.id
      });
      finalization = {
        finalizationKey: candidate.finalizationKey,
        revision,
        artifact: checkpoint.artifact,
        version: candidate.version,
        run: completedRun,
        session: completedSession,
        previewGrant,
        outbox: candidateOutbox(checkpoint.artifact, candidate.version),
        receiptIds: [receiptId, finalizationReceiptId]
      };
    }
    return {
      execution,
      tool,
      workspaceHash: runtimeSnapshot.workspaceHash,
      checkpoint: { key, contentHash, bytes: serialized.length, receiptId },
      finalization
    };
  }

  async getOrCreateSession(input: { siteId: string; principal: SiteAgentPrincipal; buildInput?: SitePublicBuildInput }) {
    const existing = await this.repository.getActiveAgentSession(input.siteId, input.principal);
    if (existing) return existing;
    const site = await this.repository.getSite(input.siteId);
    if (!site) throw new Error("Site not found.");
    const buildInputId = input.buildInput?.id ?? site.currentPublicBuildInputId;
    const buildInput = input.buildInput ?? (buildInputId ? await this.repository.getPublicBuildInput(buildInputId) : undefined);
    if (!buildInput) throw new Error("Site does not have a current public build input.");
    const now = new Date();
    const session = siteAgentSessionSchema.parse({
      schemaVersion: "site-agent-session",
      id: id("session"),
      siteId: site.id,
      principal: input.principal,
      status: "active",
      currentWorkspaceRevisionId: site.currentWorkspaceRevisionId,
      publicBuildInputId: buildInput.id,
      sandboxProvider: "cloudflare",
      sandboxId: undefined,
      leaseTokenHash: sha256(randomBytes(32)),
      leaseExpiresAt: new Date(now.getTime() + idleLeaseMs).toISOString(),
      rotateAt: new Date(now.getTime() + rotationMs).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    await this.repository.saveAgentSession(session);
    return session;
  }

  async enqueueRun(input: {
    session: SiteAgentSession;
    kind: SiteAgentRun["kind"];
    instruction: string;
    requestedBy: string;
    selection?: SiteElementSelection;
    origin?: SiteAgentRun["origin"];
    deferBehindActive?: boolean;
    publishAfterSuccess?: boolean;
    workflowStartedAt?: string;
  }) {
    if (await this.repository.isMaintenanceLeaseActive("site_authoring_maintenance", new Date().toISOString())) {
      throw new Error("site_authoring_maintenance_active");
    }
    const sessionRuns = await this.repository.listAgentRuns(input.session.id);
    const runningRun = sessionRuns.find((candidate) => candidate.status === "running");
    const queuedRun = sessionRuns.find((candidate) => candidate.status === "queued");
    const activeRun = runningRun ?? queuedRun;
    if (activeRun && !input.deferBehindActive) throw new Error(`Session already has an active run: ${activeRun.id}`);
    const current = await this.repository.getSite(input.session.siteId);
    if (!current) throw new Error("Site not found.");
    if (input.kind !== "rebase") await this.assertAiInputAllowed(current.id);
    if (input.selection?.workspaceRevisionId && input.selection.workspaceRevisionId !== current.currentWorkspaceRevisionId) {
      throw new Error("stale_selection");
    }
    if (!current.currentPublicBuildInputId) throw new Error("Site does not have a current public build input.");
    if (input.session.publicBuildInputId !== current.currentPublicBuildInputId) {
      await this.repository.saveAgentSession(siteAgentSessionSchema.parse({
        ...input.session,
        publicBuildInputId: current.currentPublicBuildInputId,
        updatedAt: new Date().toISOString()
      }));
    }
    const buildInput = await this.requireBuildInput(current.currentPublicBuildInputId);
    const now = new Date().toISOString();
    const taskSkill = taskSkillFor(input.kind);
    const modelSettings = await getSiteAuthoringModelSettings();
    const apiProvider = siteAgentApiProviderSchema.parse(process.env.LODESTA_SITE_AGENT_PROVIDER?.trim() || modelSettings.settings.siteAgentProvider);
    const modelId = process.env.LODESTA_SITE_AGENT_MODEL?.trim() || modelSettings.settings.siteAgentModel;
    const coalesced = input.origin === "control_plane"
      ? sessionRuns.find((candidate) => candidate.status === "queued" && candidate.origin === "control_plane")
      : undefined;
    if (coalesced) {
      const kind = coalesced.kind === "edit" || input.kind === "edit" ? "edit" as const : "rebase" as const;
      const mergedSkill = taskSkillFor(kind);
      const updated = await this.updateRun(coalesced, {
        publicBuildInputId: buildInput.id,
        kind,
        limits: managerLimitsForKind(kind),
        exactParentRevisionId: current.currentWorkspaceRevisionId,
        deferredUntilRunId: runningRun?.id ?? coalesced.deferredUntilRunId,
        publishAfterSuccess: coalesced.publishAfterSuccess && Boolean(input.publishAfterSuccess) && kind === "rebase",
        skillVersions: {
          manager: websiteManagerPromptIdentity,
          domainContext: buildInput.domainContext?.version ?? "none",
          [mergedSkill.id]: mergedSkill.identity
        }
      });
      await this.repository.appendAgentMessage({
        schemaVersion: "site-agent-message", id: id("message"), sessionId: input.session.id, runId: updated.id,
        role: messageRole(input.session, input.requestedBy),
        content: input.instruction, selection: input.selection, createdAt: now
      });
      return updated;
    }
    const run = siteAgentRunSchema.parse({
      schemaVersion: "site-agent-run",
      id: id("run"),
      sessionId: input.session.id,
      siteId: input.session.siteId,
      publicBuildInputId: buildInput.id,
      origin: input.origin ?? (input.kind === "initial_build" ? "system" : "owner_request"),
      executionDriver: "responses_api",
      requestedBy: input.requestedBy,
      publishAfterSuccess: Boolean(input.publishAfterSuccess),
      kind: input.kind,
      status: "queued",
      stage: "queued",
      exactParentRevisionId: current.currentWorkspaceRevisionId,
      deferredUntilRunId: input.deferBehindActive ? activeRun?.id : undefined,
      apiProvider,
      modelId,
      executionNumber: 0,
      skillVersions: {
        manager: websiteManagerPromptIdentity,
        domainContext: buildInput.domainContext?.version ?? "none",
        [taskSkill.id]: taskSkill.identity
      },
      limits: managerLimitsForKind(input.kind),
      usage: { kind: "model_reported", inputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, outputTokens: 0, costUsd: 0, costSource: "unavailable", upstreamInferenceCostUsd: 0, durationMs: 0 },
      startedAt: input.workflowStartedAt ?? now
    });
    await this.repository.enqueueAgentRun(run);
    await this.repository.appendAgentMessage({
      schemaVersion: "site-agent-message",
      id: id("message"),
      sessionId: input.session.id,
      runId: run.id,
      role: messageRole(input.session, input.requestedBy),
      content: input.instruction,
      selection: input.selection,
      createdAt: now
    });
    return run;
  }

  async enqueueEdit(input: {
    session: SiteAgentSession;
    instruction: string;
    requestedBy: string;
    selection?: SiteElementSelection;
    signal?: AbortSignal;
  }) {
    const site = await this.repository.getSite(input.session.siteId);
    if (!site) throw new Error("Site not found.");
    if (input.selection?.workspaceRevisionId && input.selection.workspaceRevisionId !== site.currentWorkspaceRevisionId) throw new Error("stale_selection");
    const run = await this.enqueueRun({ session: input.session, kind: "edit", instruction: input.instruction, requestedBy: input.requestedBy, selection: input.selection });
    return { run };
  }

  async executeRun(runId: string, selection?: SiteElementSelection) {
    let current = await this.requireRun(runId);
    if (current.status !== "queued") return current;
    if (current.deferredUntilRunId) {
      const predecessor = await this.repository.getAgentRun(current.deferredUntilRunId);
      if (predecessor && (predecessor.status === "queued" || predecessor.status === "running")) return current;
      const site = await this.repository.getSite(current.siteId);
      if (!site) throw new Error("Site not found.");
      current = await this.updateRun(current, {
        exactParentRevisionId: site.currentWorkspaceRevisionId,
        deferredUntilRunId: undefined
      });
    }
    const claimed = await this.repository.claimAgentRun(runId);
    if (!claimed) return this.requireRun(runId);
    let run: SiteAgentRun = claimed;
    const deadlineAt = Date.parse(run.startedAt) + (run.kind === "initial_build" ? initialGenerationDeadlineMs : siteEditDeadlineMs);
    const remainingMs = deadlineAt - Date.now();
    try {
      if (remainingMs <= 0) throw new Error("workflow_deadline_exhausted");
      const workflowSignal = AbortSignal.timeout(remainingMs);
      const session = await this.requireSession(run.sessionId);
      const buildInput = await this.requireBuildInput(run.publicBuildInputId);
      const site = await this.repository.getSite(run.siteId);
      if (!site) throw new Error("Site not found.");
      if (run.kind !== "rebase") await this.assertAiInputAllowed(site.id);
      if ((site.currentWorkspaceRevisionId ?? undefined) !== (run.exactParentRevisionId ?? undefined)) throw new Error("stale_parent_revision");
      if (run.kind === "rebase") {
        const sandboxState = await this.ensureSandbox(session, buildInput);
        return await this.executeDeterministicRebase({ run, session: sandboxState.session, buildInput, sandboxRevision: sandboxState.revision, signal: workflowSignal });
      }
      const sandboxState = await this.ensureSandbox(session, buildInput);
      const currentFiles = run.kind === "initial_build"
        ? undefined
        : await this.loadWorkspaceSource(site.currentWorkspaceRevisionId);
      const snapshots = (await Promise.all(buildInput.sourceSnapshotIds.map((id) => this.repository.getSourceSnapshot(id))))
        .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot));
      const authoringContext = createAuthoringContextPacket({ buildInput, snapshots });
      const requestMessages = (await this.repository.listAgentMessages(session.id)).filter((message) => message.runId === run.id && (message.role === "owner" || message.role === "operator"));
      const ownerMessage = requestMessages.map((message) => message.content).join("\n\n")
        || "Apply the requested site change.";
      const outcome = await this.runAuthoring({
        run,
        session: sandboxState.session,
        buildInput,
        authoringContext,
        sandboxRevision: sandboxState.revision,
        currentFiles,
        instruction: ownerMessage,
        selection: selection ?? requestMessages.find((message) => message.selection)?.selection,
        kind: run.kind,
        signal: workflowSignal
      });
      run = outcome.run;
      if (outcome.artifact.qa.hardGate === "failed") {
        throw new SiteAuthoringTerminalError(
          "authoring_unresolved",
          "authoring",
          false,
          "Candidate failed the release hard gate."
        );
      }
      const candidate = await this.createCandidateDraft(outcome.artifact, outcome.revision.id, outcome.buildInput, run, outcome.inspectionHash);
      const completedAt = new Date().toISOString();
      const completedRun = siteAgentRunSchema.parse({
        ...run,
        status: "succeeded",
        stage: "candidate_ready",
        fastPreviewPath: undefined,
        outputRevisionId: outcome.revision.id,
        candidateVersionId: candidate.version.id,
        completedAt
      });
      const completedSession = siteAgentSessionSchema.parse({
        ...outcome.session,
        status: "active",
        currentWorkspaceRevisionId: outcome.revision.id,
        leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(),
        updatedAt: completedAt
      });
      const outbox = candidateOutbox(outcome.artifact, candidate.version);
      const finalized = await this.repository.finalizeVerifiedAuthoring({
        finalizationKey: candidate.finalizationKey,
        revision: outcome.revision,
        artifact: outcome.artifact,
        version: candidate.version,
        run: completedRun,
        session: completedSession,
        outboxDocument: outbox,
        mediaAdoption: outcome.mediaAdoption
      });
      await externalAuthoringRepository.enqueueOutbox(outbox);
      run = finalized.run;
      const version = finalized.version;
      await this.repository.appendAgentMessage({
        schemaVersion: "site-agent-message", id: id("message"), sessionId: run.sessionId, runId: run.id, role: "agent",
        content: outcome.ownerMessage, createdAt: new Date().toISOString()
      });
      await this.destroySessionSandbox(outcome.session, {
        reason: "terminal_run_success",
        currentWorkspaceRevisionId: outcome.revision.id
      });
      return run;
    } catch (error) {
      if (error instanceof ManagerNeedsInputError) {
        const latest = await this.repository.getAgentRun(run.id) ?? run;
        const now = new Date().toISOString();
        const waiting = await this.updateRun(latest, {
          status: "needs_input",
          stage: "needs_input",
          fastPreviewPath: undefined,
          inputQuestion: error.question,
          inputExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
        });
        await this.repository.failOpenAgentRunEvents(waiting.id, now, "needs_input").catch(() => undefined);
        await this.checkpointAfterRunFailure(waiting).catch(() => undefined);
        await this.repository.appendAgentMessage({
          schemaVersion: "site-agent-message", id: id("message"), sessionId: waiting.sessionId, runId: waiting.id, role: "agent",
          content: error.question, createdAt: now
        });
        const site = await this.repository.getSite(waiting.siteId);
        const state = site ? await this.repository.getBusinessState(site.businessId) : undefined;
        if (site && state) {
          await sendOwnerOperationalEmail({
            site, business: state, kind: "website_input_needed",
            subject: "Your website update needs one answer",
            summaryLines: [error.question, "The update is paused and no editing sandbox is being held while we wait."],
            actionPath: `/workspace/${site.slug}/editor`
          }).catch(() => undefined);
        }
        return waiting;
      }
      if (Date.now() >= deadlineAt) {
        error = new SiteAuthoringTerminalError("deadline_exhausted", "budget", false, "workflow_deadline_exhausted");
      }
      const failure = classifySiteAuthoringFailure(error);
      const latest = await this.repository.getAgentRun(run.id) ?? run;
      await this.repository.failOpenAgentRunEvents(run.id, new Date().toISOString(), failure.code).catch(() => undefined);
      await this.checkpointAfterRunFailure(latest).catch(() => undefined);
      await this.queueTerminalRunFailure(latest, failure).catch(() => undefined);
      const failed = await this.updateRun(latest, {
        status: "failed",
        stage: "failed",
        fastPreviewPath: undefined,
        failureCode: failure.code,
        failureCategory: failure.category,
        retryableByOwner: failure.retryableByOwner,
        failureReason: failure.message,
        completedAt: new Date().toISOString()
      });
      return failed;
    }
  }

  async executeRunAndFinalize(runId: string, selection?: SiteElementSelection) {
    const run = await this.executeRun(runId, selection);
    if (!run.publishAfterSuccess || run.status !== "succeeded" || !run.candidateVersionId) return run;
    const site = await this.repository.getSite(run.siteId);
    if (site?.currentPublicBuildInputId !== run.publicBuildInputId) return run;
    try {
      await this.promoteVersion(run.candidateVersionId, run.requestedBy);
    } catch (error) {
      const now = new Date().toISOString();
      await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
        schemaVersion: "operator-queue-item",
        id: id("operator"), siteId: run.siteId, versionId: run.candidateVersionId, runId: run.id,
        reason: "stale_candidate", severity: "urgent", status: "open",
        findings: [{ message: error instanceof Error ? error.message : String(error) }],
        createdAt: now, updatedAt: now
      }));
    }
    return run;
  }

  async resumeNeedsInput(input: { runId: string; sessionId: string; answer: string; actorId: string }) {
    const waiting = await this.requireRun(input.runId);
    if (waiting.sessionId !== input.sessionId) throw new Error("run_session_mismatch");
    if (waiting.status !== "needs_input" || !waiting.inputQuestion || !waiting.inputExpiresAt) throw new Error("run_is_not_waiting_for_input");
    const [session, site, messages] = await Promise.all([
      this.requireSession(waiting.sessionId),
      this.repository.getSite(waiting.siteId),
      this.repository.listAgentMessages(waiting.sessionId)
    ]);
    if (!site) throw new Error("Site not found.");
    if (session.principal.id !== input.actorId) throw new Error("Session principal mismatch.");
    await this.assertAiInputAllowed(site.id);
    const answer = input.answer.trim();
    if (!answer) throw new Error("clarification_answer_required");
    const now = new Date().toISOString();
    if (!site.currentPublicBuildInputId) throw new Error("Site does not have a current public build input.");
    const currentSession = session.publicBuildInputId === site.currentPublicBuildInputId
      ? session
      : siteAgentSessionSchema.parse({
          ...session,
          publicBuildInputId: site.currentPublicBuildInputId,
          updatedAt: now
        });
    if (currentSession !== session) await this.repository.saveAgentSession(currentSession);
    const original = messages.filter((message) => message.runId === waiting.id && (message.role === "owner" || message.role === "operator"))[0]?.content
      ?? "Apply the requested website change.";
    if (waiting.inputExpiresAt <= now) {
      await this.updateRun(waiting, { status: "cancelled", completedAt: now });
      return this.enqueueRun({
        session: currentSession,
        kind: waiting.kind,
        instruction: `${original}\n\n${principalLabel(session)} clarification: ${answer}`,
        requestedBy: input.actorId,
        origin: waiting.origin
      });
    }
    if ((await this.repository.listAgentRuns(currentSession.id)).some((run) => run.id !== waiting.id && (run.status === "queued" || run.status === "running"))) {
      throw new Error("session_has_active_run");
    }
    await this.repository.appendAgentMessage({
      schemaVersion: "site-agent-message", id: id("message"), sessionId: currentSession.id, runId: waiting.id,
      role: session.principal.kind, content: `${principalLabel(session)} clarification: ${answer}`, createdAt: now
    });
    return this.updateRun(waiting, {
      status: "queued",
      stage: "queued",
      publicBuildInputId: currentSession.publicBuildInputId,
      exactParentRevisionId: site.currentWorkspaceRevisionId,
      inputQuestion: undefined,
      inputExpiresAt: undefined,
      startedAt: now,
      heartbeatAt: undefined
    });
  }

  async discuss(input: {
    sessionId: string;
    ownerId: string;
    message: string;
    selection?: SiteElementSelection;
    signal?: AbortSignal;
  }) {
    const session = await this.requireSession(input.sessionId);
    if (session.principal.kind !== "owner" || session.principal.id !== input.ownerId) throw new Error("Session owner mismatch.");
    await this.assertAiInputAllowed(session.siteId);
    const buildInput = await this.requireBuildInput(session.publicBuildInputId);
    const source = session.currentWorkspaceRevisionId ? await this.loadWorkspaceSource(session.currentWorkspaceRevisionId) : undefined;
    await this.repository.appendAgentMessage({
      schemaVersion: "site-agent-message", id: id("message"), sessionId: session.id, role: "owner", content: input.message,
      selection: input.selection, createdAt: new Date().toISOString()
    });
    const result = await this.manager.discuss({
      buildInput,
      message: input.message,
      currentFiles: source,
      selection: input.selection,
      signal: input.signal
    });
    await this.repository.appendAgentMessage({
      schemaVersion: "site-agent-message", id: id("message"), sessionId: session.id, role: "agent", content: result.discussion.response,
      createdAt: new Date().toISOString()
    });
    return result;
  }

  async processRecoverableRuns(input: { limit?: number; staleAfterMs?: number } = {}) {
    const limit = Math.max(1, Math.min(input.limit ?? 4, 20));
    const reaped = await this.reapExpiredSessions({ limit });
    const staleAfterMs = input.staleAfterMs ?? siteAgentRecoveryStaleAfterMs;
    const staleBefore = new Date(Date.now() - staleAfterMs).toISOString();
    const stale = await this.repository.listStaleRunningAgentRuns(staleBefore, limit);
    const recovered: string[] = [];
    for (const run of stale) {
      const result = await this.recoverRunIfStale(run.id, staleAfterMs);
      if (result.status !== "running") recovered.push(run.id);
    }
    const now = new Date().toISOString();
    for (const run of (await this.repository.listRecentAgentRuns({ status: "needs_input", limit: 100 })).filter((item) => item.executionDriver === "responses_api")) {
      if (run.inputExpiresAt && run.inputExpiresAt <= now) await this.updateRun(run, { status: "cancelled", completedAt: now });
    }
    const queued = (await this.repository.listQueuedAgentRuns(limit)).filter((run) => run.executionDriver === "responses_api");
    const processed: SiteAgentRun[] = [];
    for (const run of queued) processed.push(await this.executeRunAndFinalize(run.id));
    return { reaped, recovered, processed };
  }

  async reapExpiredSessions(input: { limit?: number; now?: string } = {}) {
    const now = input.now ?? new Date().toISOString();
    const sessions = await this.repository.listExpiredAgentSessions(now, Math.max(1, Math.min(input.limit ?? 20, 100)));
    const reaped: string[] = [];
    for (const session of sessions) {
      const activeRun = (await this.repository.listAgentRuns(session.id)).some((run) => run.status === "queued" || run.status === "running");
      if (activeRun) continue;
      const site = await this.repository.getSite(session.siteId);
      const destroyed = await this.destroySessionSandbox(session, {
        reason: "expired_session_reaper",
        currentWorkspaceRevisionId: site?.currentWorkspaceRevisionId,
        now
      });
      if (!destroyed.destroyed) continue;
      reaped.push(session.id);
    }
    return reaped;
  }

  async recoverRunIfStale(runId: string, staleAfterMs = siteAgentRecoveryStaleAfterMs) {
    const run = await this.requireRun(runId);
    if (run.status !== "running") return run;
    const heartbeat = Date.parse(run.heartbeatAt ?? run.startedAt);
    if (heartbeat > Date.now() - staleAfterMs) return run;
    return this.recoverInterruptedRun(run);
  }

  async retryFailedRun(input: { runId: string; actorId: string }) {
    const failed = await this.requireRun(input.runId);
    if (failed.status !== "failed") throw new Error("Only failed runs can be retried.");
    if (!failed.retryableByOwner) throw new Error("run_not_retryable");
    const [session, site, runs, messages] = await Promise.all([
      this.requireSession(failed.sessionId),
      this.repository.getSite(failed.siteId),
      this.repository.listAgentRuns(failed.sessionId),
      this.repository.listAgentMessages(failed.sessionId)
    ]);
    if (!site || site.currentPublicBuildInputId !== failed.publicBuildInputId || session.publicBuildInputId !== failed.publicBuildInputId) {
      throw new Error("stale_failed_run");
    }
    if (runs.some((run) => run.id !== failed.id && (run.status === "queued" || run.status === "running"))) {
      throw new Error("session_has_active_run");
    }
    const request = messages.filter((message) => message.runId === failed.id && (message.role === "owner" || message.role === "operator")).at(-1);
    if (!request) throw new Error("Failed run request is unavailable.");
    const retried = await this.enqueueRun({
      session,
      kind: failed.kind,
      instruction: request.content,
      requestedBy: input.actorId,
      selection: request.selection,
      origin: failed.origin,
      publishAfterSuccess: false
    });
    return retried;
  }

  async promoteVersion(versionId: string, actorId: string) {
    const readiness = await deriveSitePublicationReadiness({
      versionId,
      repository: this.repository,
      operationsRepository: this.operationsRepository
    });
    if (readiness.status !== "ready") throw new Error(`publication_blocked:${readiness.blockers.map((blocker) => blocker.code).join(",")}`);
    await this.repository.promoteSiteVersion(versionId, actorId);
    return this.repository.getSiteVersion(versionId);
  }

  async restoreVersion(versionId: string, actorId: string) {
    const version = await this.repository.getSiteVersion(versionId);
    if (!version) throw new Error("Site version not found.");
    const site = await this.repository.getSite(version.siteId);
    if (!site?.currentPublicBuildInputId) throw new Error("Site does not have a current public build input.");
    const [targetRevision, buildInput] = await Promise.all([
      this.repository.getWorkspaceRevision(version.workspaceRevisionId),
      this.repository.getPublicBuildInput(site.currentPublicBuildInputId)
    ]);
    if (!targetRevision || !buildInput) throw new Error("Retained version inputs are unavailable.");
    const backupId = targetRevision.sourceArchiveKey.match(/^workspace-backups\/([a-f0-9]{64})\.tar\.gz$/)?.[1];
    if (!backupId) throw new Error("Retained workspace backup is unavailable.");
    let session = await this.getOrCreateSession({ siteId: site.id, principal: { kind: "owner", id: actorId }, buildInput });
    session = siteAgentSessionSchema.parse({ ...session, publicBuildInputId: buildInput.id, updatedAt: new Date().toISOString() });
    await this.repository.saveAgentSession(session);
    const sandbox = await this.ensureSandbox(session, buildInput);
    const sidecar = await this.loadWorkspaceSidecar(targetRevision);
    await this.sandbox.restore(sandbox.session.sandboxId!, backupId, sandbox.revision, sidecar.archiveHash);
    return this.enqueueRun({
      session: sandbox.session,
      kind: "rebase",
      instruction: `Restore retained version ${version.number} and recompile it against the current verified business snapshot.`,
      requestedBy: actorId
    });
  }

  private async runAuthoring(input: {
    run: SiteAgentRun;
    session: SiteAgentSession;
    buildInput: SitePublicBuildInput;
    authoringContext: ReturnType<typeof createAuthoringContextPacket>;
    sandboxRevision: string;
    currentFiles?: WorkspaceSourceFile[];
    instruction: string;
    selection?: SiteElementSelection;
    kind: ManagerRunRequest["kind"];
    signal?: AbortSignal;
  }) {
    let run = await this.updateRun(input.run, { stage: "authoring" });
    const baseState = await this.repository.getBusinessState(input.buildInput.businessId);
    if (!baseState || baseState.revision !== input.buildInput.businessStateRevision) {
      throw new Error("Authoring input does not match the canonical business state.");
    }
    let effectiveState = baseState;
    let effectiveBuildInput = input.buildInput;
    const generatedRevisions: AssetRevision[] = [];
    const generatedRefs: AssetRevisionRef[] = [];
    const refreshEffectiveMedia = (refs: AssetRevisionRef[]) => {
      if (!refs.length) {
        effectiveState = baseState;
        effectiveBuildInput = input.buildInput;
        return;
      }
      const revisionIds = new Set(refs.map((item) => item.revisionId));
      effectiveState = prospectiveMediaState(baseState, refs);
      effectiveBuildInput = createPublicBuildInput({
        id: deterministicId("input", {
          schemaVersion: 1,
          runId: run.id,
          generatedAssetRevisionIds: generatedRevisions.filter((item) => revisionIds.has(item.id)).map((item) => item.id)
        }),
        state: effectiveState,
        intent: input.buildInput.intent,
        forms: input.buildInput.forms,
        domainContext: input.buildInput.domainContext,
        sourceSnapshotIds: input.buildInput.sourceSnapshotIds,
        runtimeSeriesId
      });
    };
    const mediaSheet = await this.mediaSheetFor(input.buildInput);
    const recorder = new SiteAgentEventRecorder(this.repository, this.blobStore, run.id);
    const runEvent = await recorder.open({
      kind: "run",
      name: input.kind,
      summary: { kind: input.kind, publicBuildInputId: input.buildInput.id }
    });
    const fastPreviewPath = `/api/site-agent/sessions/${input.session.id}/preview`;
    if (run.usage.kind !== "model_reported") throw new Error("responses_run_usage_required");
    const baseUsage = { ...run.usage };
    const configuredLimits = run.limits ?? managerLimitsForKind(input.kind);
    if (baseUsage.inputTokens >= configuredLimits.maxInputTokens) {
      throw new SiteAuthoringTerminalError("input_budget_exhausted", "budget", false, "research_exhausted_initial_input_budget");
    }
    if (baseUsage.outputTokens >= configuredLimits.maxOutputTokens) {
      throw new SiteAuthoringTerminalError("output_budget_exhausted", "budget", false, "research_exhausted_initial_output_budget");
    }
    if (baseUsage.durationMs >= configuredLimits.maxDurationMs) {
      throw new SiteAuthoringTerminalError("deadline_exhausted", "budget", false, "research_exhausted_initial_model_deadline");
    }
    const remainingLimits = {
      maxInputTokens: configuredLimits.maxInputTokens - baseUsage.inputTokens,
      maxOutputTokens: configuredLimits.maxOutputTokens - baseUsage.outputTokens,
      maxDurationMs: configuredLimits.maxDurationMs - baseUsage.durationMs
    };
    let activeSession = input.session;
    let activeSandboxRevision = input.sandboxRevision;
    let sandboxPublicBuildInputId = activeSession.sandboxId && activeSandboxRevision !== "deferred"
      ? input.buildInput.id
      : undefined;
    const ensureBuildSandbox = async () => {
      if (!activeSession.sandboxId || activeSandboxRevision === "deferred") {
        const state = await this.ensureSandbox(activeSession, effectiveBuildInput);
        activeSession = state.session;
        activeSandboxRevision = state.revision;
        sandboxPublicBuildInputId = effectiveBuildInput.id;
      }
      if (sandboxPublicBuildInputId !== effectiveBuildInput.id) {
        const rebased = await this.sandbox.rebase(activeSession.sandboxId!, activeSandboxRevision, effectiveBuildInput);
        activeSandboxRevision = rebased.revision;
        sandboxPublicBuildInputId = effectiveBuildInput.id;
      }
    };
    type RevisionDraft = Omit<SiteWorkspaceRevision, "sourceArchiveKey">;
    type Checkpoint = Awaited<ReturnType<SiteAuthoringWorkflow["verifySandboxArtifact"]>> & { revisionDraft: RevisionDraft };
    const runtime = new WorkspaceManagerRuntime<Checkpoint>({
      kind: input.kind,
      publicBuildInputId: input.buildInput.id,
      getPublicBuildInputId: () => effectiveBuildInput.id,
      toolchainVersion: siteToolchainIdentity,
      sandboxImageDigest: configuredSandboxImageDigest(),
      initialFiles: input.currentFiles,
      initialSandboxRevision: input.sandboxRevision,
      createImage: async (rawArgs) => {
        const args = rawArgs as CreateImageRequest;
        const sources = await Promise.all(args.sourceAssetIds.map(async (assetId) => {
          const asset = effectiveBuildInput.business.assets.find((candidate) => candidate.assetId === assetId);
          if (!asset) throw new Error(`Unknown source asset ${assetId}.`);
          const blob = await this.blobStore.get(asset.storageKey);
          if (!blob) throw new Error(`Source asset bytes are unavailable for ${assetId}.`);
          return { revisionId: asset.revisionId, mimeType: asset.mimeType, bytes: blob.bytes };
        }));
        const created = await this.imageCreator(args, sources, { signal: input.signal });
        const contentHash = sha256(created.bytes);
        const assetId = id("asset_generated");
        const revisionId = id("asset_revision");
        const storageKey = `site-assets/${input.buildInput.businessId}/${contentHash.slice("sha256:".length)}`;
        const revision = assetRevisionSchema.parse({
          schemaVersion: 1,
          id: revisionId,
          assetId,
          businessId: input.buildInput.businessId,
          contentHash,
          storageKey,
          mimeType: created.mimeType,
          bytes: created.bytes.length,
          width: created.width,
          height: created.height,
          origin: "platform_generated",
          provenance: {
            origin: "platform_generated",
            provider: "openai",
            model: "gpt-image-2",
            action: args.action,
            purpose: args.purpose,
            prompt: args.prompt,
            sourceAssetRevisionIds: created.sourceAssetRevisionIds
          },
          createdAt: new Date().toISOString()
        });
        const ref: AssetRevisionRef = {
          assetId,
          revisionId,
          kind: args.purpose === "logo" ? "logo" : "photo",
          contentHash,
          storageKey,
          mimeType: created.mimeType,
          alt: args.alt,
          width: created.width,
          height: created.height,
          origin: "platform_generated",
          sourceFactIds: [],
          activeForFutureBuilds: true
        };
        await this.blobStore.putImmutable({ key: storageKey, bytes: created.bytes, contentType: created.mimeType, contentHash });
        generatedRevisions.push(revision);
        generatedRefs.push(ref);
        refreshEffectiveMedia(generatedRefs);
        return {
          modelOutput: [
            { type: "input_text", text: JSON.stringify({ ok: true, assetId, revisionId, width: created.width, height: created.height, alt: args.alt, publicBuildInputId: effectiveBuildInput.id }) },
            { type: "input_image", image_url: `data:${created.mimeType};base64,${created.bytes.toString("base64")}`, detail: "high" }
          ],
          diagnosticOutput: {
            ok: true,
            assetId,
            revisionId,
            width: created.width,
            height: created.height,
            contentHash,
            publicBuildInputId: effectiveBuildInput.id
          }
        };
      },
      applyBuild: async (files, expectedRevision) => {
        run = await this.updateRun(run, { stage: "building" });
        await ensureBuildSandbox();
        const revision = activeSandboxRevision;
        void expectedRevision;
        let applied: Awaited<ReturnType<SiteSandboxClient["apply"]>>;
        try {
          applied = await this.sandbox.apply(activeSession.sandboxId!, revision, files);
        } catch (error) {
          if (isRepairableSandboxBuildError(error)) throw error;
          throw platformTerminalError(error);
        }
        activeSandboxRevision = applied.revision;
        run = await this.updateRun(run, { stage: "fast_preview", fastPreviewPath });
        return { ...applied, previewPath: fastPreviewPath };
      },
      retainDiagnostic: async (kind, content) => {
        const bytes = Buffer.from(content);
        const contentHash = sha256(bytes);
        const key = `site-agent-runs/${run.id}/diagnostics/${kind}-${contentHash.slice("sha256:".length)}.txt`;
        await this.blobStore.putImmutable({ key, bytes, contentType: "text/plain; charset=utf-8", contentHash });
        return { key, contentHash, bytes: bytes.length };
      },
      inspect: async (files, sandboxRevision): Promise<RuntimeInspection<Checkpoint>> => {
        run = await this.updateRun(run, { stage: "verifying" });
        const site = await this.repository.getSite(run.siteId);
        if (!site) throw new Error("Site not found.");
        const parent = site.currentWorkspaceRevisionId ? await this.repository.getWorkspaceRevision(site.currentWorkspaceRevisionId) : undefined;
        const sourceHash = sha256(stableJson(files));
        const workspaceRevisionId = deterministicId("workspace_revision", {
          schemaVersion: 1,
          runId: run.id,
          siteId: run.siteId,
          parentRevisionId: site.currentWorkspaceRevisionId ?? null,
          sourceHash
        });
        let finalized = await this.verifySandboxArtifact({
          run,
          session: activeSession,
          buildInput: effectiveBuildInput,
          workspaceRevisionId,
          signal: input.signal
        });
        if (finalized.artifact.qa.hardGate === "passed" && generatedRefs.length) {
          const source = files.map((file) => file.content).join("\n");
          const usedGeneratedRefs = generatedRefs.filter((asset) => source.includes(asset.assetId) || source.includes(asset.revisionId));
          const activeRunGeneratedCount = generatedRefs.filter((asset) => effectiveBuildInput.assetRevisionIds.includes(asset.revisionId)).length;
          if (usedGeneratedRefs.length !== activeRunGeneratedCount) {
            refreshEffectiveMedia(usedGeneratedRefs);
            const rebased = await this.sandbox.rebase(activeSession.sandboxId!, activeSandboxRevision, effectiveBuildInput);
            activeSandboxRevision = rebased.revision;
            sandboxPublicBuildInputId = effectiveBuildInput.id;
            finalized = await this.verifySandboxArtifact({
              run,
              session: activeSession,
              buildInput: effectiveBuildInput,
              workspaceRevisionId,
              signal: input.signal
            });
          }
        }
        const errors = finalized.artifact.qa.findings.filter((finding) => finding.severity === "error");
        const warnings = finalized.artifact.qa.findings.filter((finding) => finding.severity === "warning");
        let checkpoint: Checkpoint | undefined;
        if (finalized.artifact.qa.hardGate === "passed") {
          const revisionDraft = {
            schemaVersion: 1,
            id: workspaceRevisionId,
            siteId: run.siteId,
            parentRevisionId: site.currentWorkspaceRevisionId,
            revisionNumber: (parent?.revisionNumber ?? 0) + 1,
            sourceHash,
            files: files.map((file) => ({ path: file.path, contentHash: sha256(file.content), bytes: Buffer.byteLength(file.content) })),
            createdAt: new Date().toISOString(),
            createdBy: { kind: "agent", id: run.id }
          } satisfies RevisionDraft;
          checkpoint = { ...finalized, revisionDraft };
        }
        const runtimePatch = await this.repository.getRuntimePatch(finalized.artifact.runtimePatchAtFinalization);
        if (!runtimePatch) throw new Error("Finalized runtime patch is unavailable.");
        const inspectionHash = sha256(stableJson({
          schemaVersion: 1,
          workspaceHash: sourceHash,
          publicBuildInputHash: effectiveBuildInput.inputHash,
          verificationPolicyVersion: siteVerificationPolicyIdentity,
          sourcePolicyVersion: workspaceSourcePolicyIdentity,
          toolchainVersion: siteToolchainIdentity,
          sandboxImageDigest: configuredSandboxImageDigest(),
          runtimePatchHash: runtimePatch.contentHash,
          artifactContentHash: semanticArtifactContentHash(finalized.artifact),
          hardGate: finalized.artifact.qa.hardGate,
          findings: normalizedInspectionFindings(finalized.artifact.qa.findings),
          captures: finalized.browserCaptures
            .map((capture) => ({ route: capture.route, viewport: capture.viewport, contentHash: sha256(capture.bytes) }))
            .sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
        }));
        return {
          passed: finalized.artifact.qa.hardGate === "passed",
          inspectionHash,
          modelSummary: {
            ok: finalized.artifact.qa.hardGate === "passed",
            workspaceHash: sourceHash,
            sandboxRevision,
            publicBuildInputId: effectiveBuildInput.id,
            toolchainVersion: siteToolchainIdentity,
            sandboxImageDigest: configuredSandboxImageDigest(),
            inspectionHash,
            routes: finalized.artifact.routes,
            findingCount: finalized.artifact.qa.findings.length,
            blockerCount: errors.length,
            advisoryCount: warnings.length,
            findings: finalized.artifact.qa.findings.slice(0, 100),
            blockers: errors.slice(0, 100),
            advisories: warnings.slice(0, 100)
          },
          diagnosticSummary: {
            ok: finalized.artifact.qa.hardGate === "passed",
            workspaceHash: sourceHash,
            sandboxRevision,
            inspectionHash,
            artifactHash: finalized.artifact.artifactHash,
            findingCount: finalized.artifact.qa.findings.length,
            errorCount: errors.length,
            warningCount: warnings.length,
            routeSimilarity: finalized.qualityMetrics.routeSimilarity,
            screenshotKeys: finalized.artifact.qa.screenshotKeys
          },
          images: finalized.contactSheet ? [{ type: "input_image", image_url: `data:image/png;base64,${finalized.contactSheet.toString("base64")}`, detail: "high" }] : undefined,
          checkpoint
        };
      }
    });
    const managerResult = await this.manager.run({
      buildInput: input.buildInput,
      authoringContext: input.authoringContext,
      runId: run.id,
      instruction: input.instruction,
      kind: input.kind,
      limits: remainingLimits,
      selection: input.selection,
      signal: input.signal,
      mediaSheet: mediaSheet
        ? { dataUrl: `data:image/png;base64,${mediaSheet.toString("base64")}`, assetCount: input.buildInput.business.assets.length }
        : undefined,
      runtime,
      onEvents: async (events) => {
        const selectedRoute = events.find((event) => event.kind === "model_request" && event.modelId && event.apiProvider);
        if (selectedRoute && (run.modelId !== selectedRoute.modelId || run.apiProvider !== selectedRoute.apiProvider)) {
          run = await this.updateRun(run, { apiProvider: selectedRoute.apiProvider, modelId: selectedRoute.modelId });
        }
        await recorder.recordManagerEvents(events);
      },
      onUsage: async ({ usage, apiProvider, modelId }) => {
        run = await this.updateRun(run, {
          apiProvider,
          modelId,
          usage: {
            kind: "model_reported",
            inputTokens: baseUsage.inputTokens + usage.inputTokens,
            cachedInputTokens: baseUsage.cachedInputTokens + usage.cachedInputTokens,
            reasoningTokens: baseUsage.reasoningTokens + usage.reasoningTokens,
            outputTokens: baseUsage.outputTokens + usage.outputTokens,
            costUsd: baseUsage.costUsd + usage.costUsd,
            costSource: combinedRunCostSource(baseUsage, usage),
            upstreamInferenceCostUsd: baseUsage.upstreamInferenceCostUsd + usage.upstreamInferenceCostUsd,
            durationMs: baseUsage.durationMs + usage.durationMs
          }
        });
      },
      onProgress: async ({ usage, apiProvider, modelId }) => {
        run = await this.updateRun(run, {
          apiProvider,
          modelId,
          usage: {
            kind: "model_reported",
            inputTokens: baseUsage.inputTokens + usage.inputTokens,
            cachedInputTokens: baseUsage.cachedInputTokens + usage.cachedInputTokens,
            reasoningTokens: baseUsage.reasoningTokens + usage.reasoningTokens,
            outputTokens: baseUsage.outputTokens + usage.outputTokens,
            costUsd: baseUsage.costUsd + usage.costUsd,
            costSource: combinedRunCostSource(baseUsage, usage),
            upstreamInferenceCostUsd: baseUsage.upstreamInferenceCostUsd + usage.upstreamInferenceCostUsd,
            durationMs: baseUsage.durationMs + usage.durationMs
          }
        });
      }
    });
    const checkpoint = runtime.finalCheckpoint();
    const backup = await this.sandbox.backup(activeSession.sandboxId!);
    const revision = siteWorkspaceRevisionSchema.parse({ ...checkpoint.revisionDraft, sourceArchiveKey: backup.backup.key });
    const finalized = checkpoint;
    await this.persistVerificationCaptures(finalized);
    await this.persistWorkspaceSourceSidecar(revision, runtime.currentFiles(), backup.backup);
    await persistFinalArtifact({ artifact: finalized.artifact, files: finalized.files, store: this.blobStore });
    const adoptedGeneratedRevisionIds = new Set(effectiveBuildInput.assetRevisionIds);
    const adoptedGeneratedRevisions = generatedRevisions.filter((revision) => adoptedGeneratedRevisionIds.has(revision.id));
    if (adoptedGeneratedRevisions.length) {
      activeSession = siteAgentSessionSchema.parse({
        ...activeSession,
        publicBuildInputId: effectiveBuildInput.id,
        updatedAt: new Date().toISOString()
      });
      run = siteAgentRunSchema.parse({ ...run, publicBuildInputId: effectiveBuildInput.id });
    }
    const session = siteAgentSessionSchema.parse({
      ...activeSession,
      status: "active",
      currentWorkspaceRevisionId: revision.id,
      leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(),
      updatedAt: new Date().toISOString()
    });
    run = await this.updateRun(run, {
      outputArtifactId: finalized.artifact.id,
      screenshotKeys: finalized.artifact.qa.screenshotKeys
    });
    await recorder.close(runEvent, {
      status: "succeeded",
      apiProvider: managerResult.apiProvider,
      modelId: managerResult.modelId,
      inputTokens: managerResult.usage.inputTokens,
      cachedInputTokens: managerResult.usage.cachedInputTokens,
      reasoningTokens: managerResult.usage.reasoningTokens,
      outputTokens: managerResult.usage.outputTokens,
      costUsd: managerResult.usage.costUsd,
      costSource: managerResult.usage.costSource,
      upstreamInferenceCostUsd: managerResult.usage.upstreamInferenceCostUsd,
      modelDurationMs: managerResult.usage.durationMs,
      summary: {
        hardGate: finalized.artifact.qa.hardGate,
        workspaceRevisionId: revision.id,
        artifactId: finalized.artifact.id
      }
    });
    return {
      run,
      session,
      sandboxRevision: managerResult.completion.sandboxRevision,
      files: runtime.currentFiles(),
      revision,
      artifact: finalized.artifact,
      buildInput: effectiveBuildInput,
      mediaAdoption: adoptedGeneratedRevisions.length
        ? {
            expectedBusinessRevision: baseState.revision,
            assetRevisions: adoptedGeneratedRevisions,
            businessState: effectiveState,
            publicBuildInput: effectiveBuildInput
          }
        : undefined,
      inspectionHash: managerResult.completion.inspectionHash,
      ownerMessage: managerResult.completion.ownerMessage
    };
  }

  private async executeDeterministicRebase(input: {
    run: SiteAgentRun;
    session: SiteAgentSession;
    buildInput: SitePublicBuildInput;
    sandboxRevision: string;
    signal: AbortSignal;
  }) {
    let run = await this.updateRun(input.run, { stage: "building" });
    const recorder = new SiteAgentEventRecorder(this.repository, this.blobStore, run.id);
    const runEvent = await recorder.open({ kind: "run", name: "rebase", summary: { publicBuildInputId: input.buildInput.id } });
    const assertWithinDeadline = () => {
      if (input.signal.aborted) throw new Error("workflow_deadline_exhausted");
    };
    try {
      assertWithinDeadline();
      const toolSpan = await recorder.open({ kind: "tool_call", name: "rebase_public_input", summary: { inputHash: input.buildInput.inputHash } });
      let rebased: Awaited<ReturnType<SiteSandboxClient["rebase"]>>;
      try {
        rebased = await this.sandbox.rebase(input.session.sandboxId!, input.sandboxRevision, input.buildInput);
      } catch (error) {
        throw platformTerminalError(error);
      }
      assertWithinDeadline();
      await recorder.close(toolSpan, { status: "succeeded", summary: { revision: rebased.revision }, payload: { input: { expectedRevision: input.sandboxRevision, inputHash: input.buildInput.inputHash }, output: rebased } });
      run = await this.updateRun(run, { stage: "fast_preview", fastPreviewPath: `/api/site-agent/sessions/${input.session.id}/preview` });
      const [source, site] = await Promise.all([
        this.sandbox.getSource(input.session.sandboxId!), this.repository.getSite(run.siteId)
      ]);
      assertWithinDeadline();
      if (!site) throw new Error("Site not found.");
      const parent = site.currentWorkspaceRevisionId ? await this.repository.getWorkspaceRevision(site.currentWorkspaceRevisionId) : undefined;
      const files = source.files.map((file) => workspaceSourceFileSchema.parse(file));
      const workspaceRevisionId = id("workspace_revision");
      const sourceHash = sha256(stableJson(files));
      run = await this.updateRun(run, { stage: "verifying" });
      const inspectionSpan = await recorder.open({ kind: "inspection", name: "deterministic_rebase_verification", summary: { workspaceRevisionId } });
      const finalized = await this.verifySandboxArtifact({
        run, session: input.session, buildInput: input.buildInput, workspaceRevisionId, signal: input.signal
      });
      assertWithinDeadline();
      await recorder.close(inspectionSpan, { status: finalized.artifact.qa.hardGate === "passed" ? "succeeded" : "failed", summary: { hardGate: finalized.artifact.qa.hardGate, findingCount: finalized.artifact.qa.findings.length }, payload: { findings: finalized.artifact.qa.findings }, errorCode: finalized.artifact.qa.hardGate === "failed" ? "release_hard_gate_failed" : undefined });
      if (finalized.artifact.qa.hardGate === "failed") {
        await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
          schemaVersion: "operator-queue-item",
          id: id("operator"), siteId: run.siteId, runId: run.id, reason: "verification_failure", severity: "high", status: "open",
          findings: finalized.artifact.qa.findings, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }));
        throw new SiteAuthoringTerminalError(
          "authoring_unresolved",
          "authoring",
          false,
          "Deterministic recompile failed the release hard gate."
        );
      }
      const backup = await this.sandbox.backup(input.session.sandboxId!);
      const revision = siteWorkspaceRevisionSchema.parse({
        schemaVersion: 1, id: workspaceRevisionId, siteId: run.siteId,
        parentRevisionId: site.currentWorkspaceRevisionId, revisionNumber: (parent?.revisionNumber ?? 0) + 1,
        sourceHash, sourceArchiveKey: backup.backup.key,
        files: files.map((file) => ({ path: file.path, contentHash: sha256(file.content), bytes: Buffer.byteLength(file.content) })),
        createdAt: new Date().toISOString(), createdBy: { kind: "system", id: run.id }
      });
      await this.persistVerificationCaptures(finalized);
      await this.persistWorkspaceSourceSidecar(revision, files, backup.backup);
      await persistFinalArtifact({ artifact: finalized.artifact, files: finalized.files, store: this.blobStore });
      assertWithinDeadline();
      const session = siteAgentSessionSchema.parse({
        ...input.session, status: "active", currentWorkspaceRevisionId: revision.id,
        leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(), updatedAt: new Date().toISOString()
      });
      const candidate = await this.createCandidateDraft(finalized.artifact, revision.id, input.buildInput, run);
      const completedAt = new Date().toISOString();
      const completedRun = siteAgentRunSchema.parse({
        ...run,
        status: "succeeded", stage: "candidate_ready", fastPreviewPath: undefined, outputRevisionId: revision.id,
        outputArtifactId: finalized.artifact.id, screenshotKeys: finalized.artifact.qa.screenshotKeys,
        candidateVersionId: candidate.version.id, completedAt
      });
      const outbox = candidateOutbox(finalized.artifact, candidate.version);
      const result = await this.repository.finalizeVerifiedAuthoring({
        finalizationKey: candidate.finalizationKey,
        revision,
        artifact: finalized.artifact,
        version: candidate.version,
        run: completedRun,
        session,
        outboxDocument: outbox
      });
      await externalAuthoringRepository.enqueueOutbox(outbox);
      const version = result.version;
      run = result.run;
      await recorder.close(runEvent, { status: "succeeded", summary: { workspaceRevisionId: revision.id, artifactId: finalized.artifact.id, candidateVersionId: version.id } });
      await this.repository.appendAgentMessage({
        schemaVersion: "site-agent-message", id: id("message"), sessionId: run.sessionId, runId: run.id, role: "agent",
        content: "Recompiled the existing design against the updated verified business data. No model redesign was used.",
        createdAt: new Date().toISOString()
      });
      await this.destroySessionSandbox(session, { reason: "terminal_rebase_success", currentWorkspaceRevisionId: revision.id });
      return run;
    } catch (error) {
      const cause = input.signal.aborted
        ? new SiteAuthoringTerminalError("deadline_exhausted", "budget", false, "workflow_deadline_exhausted")
        : error;
      const failure = classifySiteAuthoringFailure(cause);
      await this.repository.failOpenAgentRunEvents(run.id, new Date().toISOString(), failure.code).catch(() => undefined);
      await this.checkpointAfterRunFailure(run).catch(() => undefined);
      await this.queueTerminalRunFailure(run, failure).catch(() => undefined);
      return this.updateRun(run, {
        status: "failed",
        stage: "failed",
        fastPreviewPath: undefined,
        failureCode: failure.code,
        failureCategory: failure.category,
        retryableByOwner: failure.retryableByOwner,
        failureReason: failure.message,
        completedAt: new Date().toISOString()
      });
    }
  }

  private async verifySandboxArtifact(input: {
    run: SiteAgentRun;
    session: SiteAgentSession;
    buildInput: SitePublicBuildInput;
    workspaceRevisionId: string;
    signal?: AbortSignal;
  }) {
    try {
      const authored = await this.sandbox.getArtifact(input.session.sandboxId!);
      if (!sandboxManifestMatches(authored.compilerManifest)) {
        throw new SiteAuthoringTerminalError(
          "platform_version_mismatch",
          "platform",
          false,
          `Artifact compiler manifest does not match the controller contract. Expected ${stableJson(expectedSiteSandboxManifest)}; received ${stableJson(authored.compilerManifest)}.`
        );
      }
      const prepared = prepareSiteArtifact({ authoredArtifact: authored, buildInput: input.buildInput, runtimeSeriesId });
      const runtime = await this.ensureRuntime();
      const artifactId = deterministicId("artifact", {
        schemaVersion: 1,
        runId: input.run.id,
        siteId: input.run.siteId,
        workspaceRevisionId: input.workspaceRevisionId,
        publicBuildInputHash: input.buildInput.inputHash
      });
      const capturePrefix = `site-captures/${input.run.siteId}/${artifactId}`;
      const browserGate = await runArtifactBrowserGate({ prepared, buildInput: input.buildInput, blobStore: this.blobStore, capturePrefix, signal: input.signal });
      const contactSheet = await createArtifactContactSheet(browserGate.captures);
      const contactSheetKey = `${capturePrefix}/contact-sheet.png`;
      const thumbnail = await createArtifactThumbnail(browserGate.captures, capturePrefix);
      const finalized = finalizePreparedArtifact({
        prepared, buildInput: input.buildInput, artifactId, workspaceRevisionId: input.workspaceRevisionId,
        runtimeSeriesId, runtimePatchId: runtime.patch.id, storagePrefix: `site-artifacts/${input.run.siteId}/${artifactId}`,
        toolchainVersion: siteToolchainIdentity, sandboxImageDigest: configuredSandboxImageDigest(),
        browserGate: { findings: browserGate.findings, screenshotKeys: [...browserGate.captures.map((capture) => capture.key), contactSheetKey],
          routesChecked: browserGate.routesChecked, linksChecked: browserGate.linksChecked }
      });
      return {
        ...finalized,
        contactSheet,
        contactSheetKey,
        thumbnail,
        browserCaptures: browserGate.captures
      };
    } catch (error) {
      throw platformTerminalError(error);
    }
  }

  private async createCandidateDraft(
    artifact: SiteBuildArtifact,
    workspaceRevisionId: string,
    buildInput: SitePublicBuildInput,
    run: SiteAgentRun,
    inspectionHash: string = semanticArtifactContentHash(artifact)
  ) {
    const versions = await this.repository.listSiteVersions(run.siteId);
    const finalizationKey = sha256(stableJson({ schemaVersion: 1, executionId: run.id, inspectionHash }));
    const version = siteVersionSchema.parse({
      schemaVersion: 1,
      id: deterministicId("version", { schemaVersion: 1, finalizationKey }),
      siteId: run.siteId,
      number: (versions[0]?.number ?? 0) + 1,
      status: "candidate",
      artifactId: artifact.id,
      artifactHash: artifact.artifactHash,
      workspaceRevisionId,
      publicBuildInputId: buildInput.id,
      formDefinitionIds: buildInput.forms.map((form) => form.id),
      sourceSnapshotIds: buildInput.sourceSnapshotIds,
      assetRevisionIds: buildInput.assetRevisionIds,
      createdAt: new Date().toISOString(),
      createdBy: { kind: "agent", id: run.id }
    });
    return { version, finalizationKey };
  }

  private async persistWorkspaceSourceSidecar(
    revision: SiteWorkspaceRevision,
    files: WorkspaceSourceFile[],
    backup: { id: string; revision: string; size: number; key: string; contentHash: `sha256:${string}` }
  ) {
    const sidecar = workspaceSourceSidecarSchema.parse({
      schemaVersion: 1,
      backupId: backup.id,
      archiveKey: backup.key,
      archiveHash: backup.contentHash,
      sandboxRevision: backup.revision,
      sourceHash: revision.sourceHash,
      files: files.map((file) => ({
        path: file.path,
        content: file.content,
        contentHash: sha256(file.content),
        bytes: Buffer.byteLength(file.content)
      })),
      createdAt: revision.createdAt
    });
    if (sidecar.archiveKey !== revision.sourceArchiveKey) throw new Error("Workspace sidecar archive key does not match its revision.");
    const bytes = serializeWorkspaceSourceSidecar(sidecar);
    const key = workspaceSourceSidecarKey(revision.sourceArchiveKey);
    const contentHash = sha256(bytes);
    await this.blobStore.putImmutable({ key, bytes, contentType: "application/json; charset=utf-8", contentHash });
    const retained = await this.blobStore.get(key);
    if (!retained || retained.contentHash !== contentHash) throw new Error(`Workspace source sidecar verification failed at ${key}.`);
    this.assertWorkspaceSidecarMatchesRevision(workspaceSourceSidecarSchema.parse(JSON.parse(retained.bytes.toString("utf8"))), revision);
    return { storageKey: key, contentHash, bytes: bytes.length };
  }

  private async persistVerificationCaptures(input: {
    browserCaptures: Array<{ key: string; bytes: Buffer }>;
    contactSheet: Buffer;
    contactSheetKey: string;
    thumbnail?: { key: string; bytes: Buffer };
  }) {
    await Promise.all([
      ...input.browserCaptures.map((capture) => this.blobStore.putImmutable({
        key: capture.key,
        bytes: capture.bytes,
        contentType: "image/png",
        contentHash: sha256(capture.bytes)
      })),
      this.blobStore.putImmutable({
        key: input.contactSheetKey,
        bytes: input.contactSheet,
        contentType: "image/png",
        contentHash: sha256(input.contactSheet)
      })
    ]);
    if (input.thumbnail) {
      await this.blobStore.putImmutable({
        key: input.thumbnail.key,
        bytes: input.thumbnail.bytes,
        contentType: "image/webp",
        contentHash: sha256(input.thumbnail.bytes)
      }).catch((error) => logThumbnailFailure("store", error));
    }
  }

  private async loadWorkspaceSource(revisionId: string | undefined): Promise<WorkspaceSourceFile[]> {
    if (!revisionId) throw new Error("Site does not have a retained workspace revision.");
    const revision = await this.repository.getWorkspaceRevision(revisionId);
    if (!revision) throw new Error("Retained workspace revision is unavailable.");
    const sidecar = await this.loadWorkspaceSidecar(revision);
    return sidecar.files.map(({ path, content }) => workspaceSourceFileSchema.parse({ path, content }));
  }

  private async loadWorkspaceSidecar(revision: SiteWorkspaceRevision): Promise<WorkspaceSourceSidecar> {
    const key = workspaceSourceSidecarKey(revision.sourceArchiveKey);
    const blob = await this.blobStore.get(key);
    if (!blob) throw new Error(`Retained workspace source sidecar is missing at ${key}.`);
    const sidecar = workspaceSourceSidecarSchema.parse(JSON.parse(blob.bytes.toString("utf8")));
    this.assertWorkspaceSidecarMatchesRevision(sidecar, revision);
    return sidecar;
  }

  private assertWorkspaceSidecarMatchesRevision(sidecar: WorkspaceSourceSidecar, revision: SiteWorkspaceRevision) {
    if (sidecar.archiveKey !== revision.sourceArchiveKey || sidecar.sourceHash !== revision.sourceHash) {
      throw new Error(`Workspace sidecar does not match retained revision ${revision.id}.`);
    }
    const sidecarFiles = sidecar.files.map(({ path, contentHash, bytes }) => ({ path, contentHash, bytes }));
    if (stableJson(sidecarFiles) !== stableJson(revision.files)) {
      throw new Error(`Workspace sidecar file manifest does not match retained revision ${revision.id}.`);
    }
  }

  private async destroySessionSandbox(session: SiteAgentSession, input: {
    reason: string;
    currentWorkspaceRevisionId?: string;
    now?: string;
  }) {
    const now = input.now ?? new Date().toISOString();
    if (!session.sandboxId) {
      const checkpointed = siteAgentSessionSchema.parse({
        ...session,
        status: "checkpointed",
        currentWorkspaceRevisionId: input.currentWorkspaceRevisionId ?? session.currentWorkspaceRevisionId,
        leaseExpiresAt: now,
        updatedAt: now
      });
      await this.repository.saveAgentSession(checkpointed);
      return { destroyed: true as const, session: checkpointed };
    }
    try {
      await this.sandbox.destroy(session.sandboxId);
    } catch (error) {
      const rotating = siteAgentSessionSchema.parse({
        ...session,
        status: "rotating",
        sandboxDestroyAttempts: session.sandboxDestroyAttempts + 1,
        currentWorkspaceRevisionId: input.currentWorkspaceRevisionId ?? session.currentWorkspaceRevisionId,
        leaseExpiresAt: now,
        updatedAt: now
      });
      await this.repository.saveAgentSession(rotating);
      const existing = (await this.repository.listOperatorQueue()).some((item) =>
        item.reason === "maintenance_failure"
        && item.siteId === session.siteId
        && item.status !== "resolved"
        && item.status !== "dismissed"
        && item.findings.some((finding) => finding.sandboxId === session.sandboxId)
      );
      if (!existing) {
        await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
          schemaVersion: "operator-queue-item",
          id: id("operator"),
          siteId: session.siteId,
          reason: "maintenance_failure",
          severity: "high",
          status: "open",
          findings: [{ kind: "sandbox_destroy_failed", sandboxId: session.sandboxId, reason: input.reason, message: failureMessage(error) }],
          createdAt: now,
          updatedAt: now
        }));
      }
      return { destroyed: false as const, session: rotating };
    }
    const checkpointed = siteAgentSessionSchema.parse({
      ...session,
      status: "checkpointed",
      sandboxId: undefined,
      sandboxLastDestroyedAt: now,
      sandboxProvisionedMs: session.sandboxProvisionedMs + provisionedDurationMs(session.sandboxLastStartedAt, now),
      sandboxDestroyAttempts: session.sandboxDestroyAttempts + 1,
      currentWorkspaceRevisionId: input.currentWorkspaceRevisionId ?? session.currentWorkspaceRevisionId,
      leaseExpiresAt: now,
      updatedAt: now
    });
    await this.repository.saveAgentSession(checkpointed);
    return { destroyed: true as const, session: checkpointed };
  }

  private async ensureSandbox(session: SiteAgentSession, buildInput: SitePublicBuildInput) {
    let current = session;
    if (session.status === "closed" || session.status === "failed") throw new Error("Agent session is not reusable.");
    const leaseExpired = Date.parse(session.leaseExpiresAt) <= Date.now();
    if (leaseExpired && session.sandboxId) {
      const site = await this.repository.getSite(session.siteId);
      const result = await this.destroySessionSandbox(session, {
        reason: "expired_before_sandbox_start",
        currentWorkspaceRevisionId: site?.currentWorkspaceRevisionId
      });
      if (!result.destroyed) throw new Error("sandbox_destroy_retry_required");
      current = result.session;
    }
    const shouldRotate = Date.parse(current.rotateAt) <= Date.now();
    if (shouldRotate && current.sandboxId) {
      const result = await this.destroySessionSandbox(current, { reason: "scheduled_rotation" });
      if (!result.destroyed) throw new Error("sandbox_destroy_retry_required");
      current = siteAgentSessionSchema.parse({
        ...result.session,
        status: "rotating",
        sandboxId: sandboxId(),
        leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(),
        rotateAt: new Date(Date.now() + rotationMs).toISOString(),
        updatedAt: new Date().toISOString()
      });
      await this.repository.saveAgentSession(current);
    }
    if (current.sandboxId) {
      const diagnostics = await this.sandbox.diagnostics(current.sandboxId).catch(() => undefined);
      if (diagnostics?.ok && diagnostics.revision !== "uninitialized" && sandboxManifestMatches(diagnostics.sandboxManifest)) {
        return { session: current, revision: diagnostics.revision };
      }
      const result = await this.destroySessionSandbox(current, {
        reason: diagnostics?.ok ? "sandbox_manifest_mismatch" : "sandbox_diagnostics_unavailable",
        currentWorkspaceRevisionId: current.currentWorkspaceRevisionId
      });
      if (!result.destroyed) {
        throw new SiteAuthoringTerminalError(
          "sandbox_unavailable",
          "platform",
          false,
          "Existing sandbox could not be recycled before authoring."
        );
      }
      current = result.session;
    }
    const startedAt = new Date().toISOString();
    const starting = siteAgentSessionSchema.parse({
      ...current,
      status: "active",
      sandboxId: current.sandboxId ?? sandboxId(),
      sandboxLastStartedAt: current.sandboxLastStartedAt ?? startedAt,
      leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(),
      updatedAt: startedAt
    });
    await this.repository.saveAgentSession(starting);
    let revision: string;
    try {
      const bootstrapped = await this.sandbox.bootstrap(starting.sandboxId!, buildInput);
      revision = bootstrapped.revision;
      if (starting.currentWorkspaceRevisionId) {
        const workspace = await this.repository.getWorkspaceRevision(starting.currentWorkspaceRevisionId);
        const backupId = workspace?.sourceArchiveKey.match(/^workspace-backups\/([a-f0-9]{64})\.tar\.gz$/)?.[1];
        if (!backupId) throw new Error("Retained workspace backup is unavailable for restore.");
        const sidecar = await this.loadWorkspaceSidecar(workspace);
        revision = (await this.sandbox.restore(starting.sandboxId!, backupId, revision, sidecar.archiveHash)).revision;
      }
    } catch (error) {
      await this.destroySessionSandbox(starting, {
        reason: "sandbox_start_failed",
        currentWorkspaceRevisionId: starting.currentWorkspaceRevisionId
      });
      if (isSiteAuthoringTerminalError(error)) throw error;
      throw new SiteAuthoringTerminalError(
        "sandbox_unavailable",
        "platform",
        false,
        failureMessage(error),
        { cause: error }
      );
    }
    const diagnostics = await this.sandbox.diagnostics(starting.sandboxId!).catch(() => undefined);
    if (!diagnostics?.ok || !sandboxManifestMatches(diagnostics.sandboxManifest)) {
      await this.destroySessionSandbox(starting, {
        reason: "fresh_sandbox_manifest_mismatch",
        currentWorkspaceRevisionId: starting.currentWorkspaceRevisionId
      }).catch(() => undefined);
      throw new SiteAuthoringTerminalError(
        "platform_version_mismatch",
        "platform",
        false,
        `Sandbox manifest does not match the controller contract. Expected ${stableJson(expectedSiteSandboxManifest)}; received ${stableJson(diagnostics?.sandboxManifest ?? null)}.`
      );
    }
    const active = siteAgentSessionSchema.parse({
      ...starting,
      status: "active",
      leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(),
      rotateAt: new Date(Date.now() + rotationMs).toISOString(),
      updatedAt: new Date().toISOString()
    });
    await this.repository.saveAgentSession(active);
    return { session: active, revision };
  }

  private async checkpointAfterRunFailure(run: SiteAgentRun) {
    const [session, site] = await Promise.all([
      this.repository.getAgentSession(run.sessionId),
      this.repository.getSite(run.siteId)
    ]);
    if (!session) return;
    await this.destroySessionSandbox(session, {
      reason: "terminal_run_failure",
      currentWorkspaceRevisionId: site?.currentWorkspaceRevisionId
    });
  }

  private async queueTerminalRunFailure(
    run: SiteAgentRun,
    failure: ReturnType<typeof classifySiteAuthoringFailure>
  ) {
    if (failure.retryableByOwner) return;
    const existing = (await this.repository.listOperatorQueue()).some((item) => item.runId === run.id && item.status !== "resolved" && item.status !== "dismissed");
    if (existing) return;
    const now = new Date().toISOString();
    await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
      schemaVersion: "operator-queue-item",
      id: id("operator"),
      siteId: run.siteId,
      runId: run.id,
      reason: "authoring_runtime_failure",
      severity: run.origin === "control_plane" ? "urgent" : "high",
      status: "open",
      findings: [{
        stage: run.stage,
        failureCode: failure.code,
        failureCategory: failure.category,
        retryableByOwner: failure.retryableByOwner,
        message: failure.message
      }],
      createdAt: now,
      updatedAt: now
    }));
  }

  private async mediaSheetFor(buildInput: SitePublicBuildInput) {
    const retained = await Promise.all(buildInput.business.assets.map(async (asset) => {
      const blob = await this.blobStore.get(asset.storageKey).catch(() => undefined);
      if (!blob) return undefined;
      const revision = await this.repository.getAssetRevision(asset.revisionId).catch(() => undefined);
      const sourcePageUrl = revision?.provenance.origin === "source_website"
        ? revision.provenance.sourcePageUrl
        : undefined;
      return { asset, bytes: blob.bytes, sourcePageUrl };
    }));
    return createMediaContactSheet(retained.filter((item): item is NonNullable<typeof item> => Boolean(item)));
  }

  private async ensureRuntime() {
    const existingSeries = await this.repository.getRuntimeSeries(runtimeSeriesId);
    if (existingSeries) {
      const patch = await this.repository.getRuntimePatch(existingSeries.activePatchId);
      if (!patch) throw new Error("Trusted runtime series references a missing patch.");
      return { series: existingSeries, patch };
    }
    const prepared = await createSiteRuntimePatch({
      id: id("runtime_patch"),
      seriesId: runtimeSeriesId,
      sourceRevision: process.env.RAILWAY_GIT_COMMIT_SHA ?? "working-tree",
      builderVersion: "trusted-runtime-builder@sha256:31d24faf0bf5265f2af840b87c7c5f2e2b6811780b68e949086e5b55da80cf61",
      securityStatus: "audited",
      compatibilityStatus: "passed"
    });
    await this.blobStore.putImmutable({
      key: prepared.patch.storageKey,
      bytes: prepared.bytes,
      contentType: "application/javascript; charset=utf-8",
      contentHash: asContentHash(prepared.patch.contentHash)
    });
    const retainedPatch = await this.repository.getRuntimePatchByHash(prepared.patch.contentHash);
    const patch = retainedPatch ?? prepared.patch;
    if (patch.seriesId !== runtimeSeriesId || patch.securityStatus !== "audited" || patch.compatibilityStatus !== "passed") {
      throw new Error("Existing trusted runtime content is not eligible for the V1 runtime series.");
    }
    if (!retainedPatch) await this.repository.saveRuntimePatch(patch);
    const series = {
      schemaVersion: 1 as const,
      id: runtimeSeriesId,
      name: "Lodesta Site Runtime V1",
      activePatchId: patch.id,
      updatedAt: new Date().toISOString(),
      updatedBy: "system_runtime_bootstrap"
    };
    await this.repository.saveRuntimeSeries(series);
    return { series, patch };
  }

  private async requireRun(idValue: string) {
    const run = await this.repository.getAgentRun(idValue);
    if (!run) throw new Error("Agent run not found.");
    return run;
  }

  private async bootstrapWithUniqueSlug(input: Parameters<SitePlatformRepository["bootstrapSite"]>[0]): Promise<PlatformSiteRecord> {
    const retained = await this.repository.getSite(input.site.id);
    if (retained) {
      if (retained.businessId !== input.site.businessId || retained.normalizedSource !== input.site.normalizedSource) {
        throw new Error("Site bootstrap idempotency conflict.");
      }
      return retained;
    }
    try {
      await this.repository.bootstrapSite(input);
      return input.site;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const afterLostResponse = await this.repository.getSite(input.site.id);
      if (afterLostResponse?.businessId === input.site.businessId && afterLostResponse.normalizedSource === input.site.normalizedSource) {
        return afterLostResponse;
      }
      if (!/slug|site id or slug already exists|duplicate key.*sites.*slug/i.test(message)) throw error;
      const suffix = input.site.id.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-8);
      const site = platformSiteRecordSchema.parse({
        ...input.site,
        slug: `${input.site.slug.slice(0, Math.max(1, 111 - suffix.length)).replace(/-+$/, "")}-${suffix}`
      });
      await this.repository.bootstrapSite({ ...input, site });
      return site;
    }
  }

  private async requireSession(idValue: string) {
    const session = await this.repository.getAgentSession(idValue);
    if (!session) throw new Error("Agent session not found.");
    return session;
  }

  private async requireBuildInput(idValue: string) {
    const input = await this.repository.getPublicBuildInput(idValue);
    if (!input) throw new Error("Public build input not found.");
    return input;
  }

  private async assertAiInputAllowed(siteId: string) {
    const intent = await this.repository.getSiteIntent(siteId);
    if (!intent) throw new Error("Site intent not found.");
    if (intent.agentAccessPolicy.aiInput !== "allow") throw new Error("agent_input_disallowed");
  }

  private async updateRun(run: SiteAgentRun, patch: Partial<SiteAgentRun>) {
    const updated = siteAgentRunSchema.parse({ ...run, ...patch, heartbeatAt: new Date().toISOString() });
    await this.repository.saveAgentRun(updated);
    return updated;
  }

  private async recoverInterruptedRun(run: SiteAgentRun) {
    const current = await this.requireRun(run.id);
    if (current.status !== "running" || current.executionNumber !== run.executionNumber) return current;
    run = current;
    await this.checkpointAfterRunFailure(run).catch(() => undefined);
    const retained = (await this.repository.listSiteVersions(run.siteId))
      .find((version) => version.createdBy.kind === "agent" && version.createdBy.id === run.id);
    const latest = await this.requireRun(run.id);
    if (latest.status !== "running" || latest.executionNumber !== run.executionNumber) return latest;
    if (retained) {
      return this.updateRun(latest, {
        status: "succeeded",
        stage: "candidate_ready",
        outputRevisionId: retained.workspaceRevisionId,
        candidateVersionId: retained.id,
        fastPreviewPath: undefined,
        failureCode: undefined,
        failureCategory: undefined,
        retryableByOwner: false,
        failureReason: undefined,
        completedAt: new Date().toISOString()
      });
    }
    if (latest.executionNumber < 2) {
      return this.updateRun(latest, {
        status: "queued",
        stage: "queued",
        fastPreviewPath: undefined,
        failureCode: undefined,
        failureCategory: undefined,
        retryableByOwner: false,
        failureReason: "interrupted_run_restarting_from_last_verified_checkpoint",
        completedAt: undefined
      });
    }
    return this.updateRun(latest, {
      status: "failed",
      stage: "failed",
      fastPreviewPath: undefined,
      failureCode: "worker_interrupted",
      failureCategory: "worker",
      retryableByOwner: true,
      failureReason: "interrupted_run_recovered_from_checkpoint",
      completedAt: new Date().toISOString()
    });
  }
}

export const siteAuthoringWorkflow = new SiteAuthoringWorkflow();

function combinedRunCostSource(
  base: Extract<SiteAgentRun["usage"], { kind: "model_reported" }>,
  next: { inputTokens: number; outputTokens: number; costSource: Extract<SiteAgentRun["usage"], { kind: "model_reported" }>["costSource"] }
): Extract<SiteAgentRun["usage"], { kind: "model_reported" }>["costSource"] {
  const baseHasUsage = base.inputTokens > 0 || base.outputTokens > 0;
  const nextHasUsage = next.inputTokens > 0 || next.outputTokens > 0;
  if (!baseHasUsage) return next.costSource;
  if (!nextHasUsage) return base.costSource;
  return base.costSource === next.costSource ? base.costSource : "mixed";
}

function messageRole(session: SiteAgentSession, actorId: string): "owner" | "operator" {
  return session.principal.id === actorId ? session.principal.kind : "operator";
}

function principalLabel(session: SiteAgentSession) {
  return session.principal.kind === "owner" ? "Owner" : "Operator";
}

export const siteAgentRecoveryStaleAfterMs = 45 * 60_000;

export function configuredSandboxImageDigest() {
  return sandboxImageDigest;
}

function asContentHash(value: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error("Expected a SHA-256 content hash.");
  return value as `sha256:${string}`;
}

function sandboxId() {
  return `site-${randomUUID().replace(/-/g, "")}`;
}

function provisionedDurationMs(startedAt: string | undefined, destroyedAt: string) {
  if (!startedAt) return 0;
  const started = Date.parse(startedAt);
  const destroyed = Date.parse(destroyedAt);
  return Number.isFinite(started) && Number.isFinite(destroyed) ? Math.max(0, destroyed - started) : 0;
}

function id(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function deterministicId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(stableJson(value)).slice("sha256:".length, "sha256:".length + 32)}`;
}

function prospectiveMediaState(base: BusinessState, generatedAssets: AssetRevisionRef[]) {
  const next = {
    ...structuredClone(base),
    revision: base.revision + 1,
    assets: [...base.assets, ...generatedAssets],
    updatedAt: new Date().toISOString()
  };
  const { stateHash: _previousHash, ...withoutHash } = next;
  return businessStateSchema.parse({ ...withoutHash, stateHash: sha256(stableJson(withoutHash)) });
}

function semanticArtifactContentHash(artifact: SiteBuildArtifact) {
  return sha256(stableJson({
    schemaVersion: 1,
    siteId: artifact.siteId,
    publicBuildInputId: artifact.publicBuildInputId,
    files: artifact.files
      .map((file) => ({ path: file.path, contentType: file.contentType, contentHash: file.contentHash, bytes: file.bytes }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    routes: [...artifact.routes].sort((left, right) => left.path.localeCompare(right.path)),
    factBindings: [...artifact.factBindings].sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
    capabilityBindings: [...artifact.capabilityBindings].sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
    runtimeSeriesId: artifact.runtimeSeriesId,
    toolchainVersion: artifact.toolchainVersion,
    sandboxImageDigest: artifact.sandboxImageDigest
  }));
}

function normalizedInspectionFindings(findings: SiteBuildArtifact["qa"]["findings"]) {
  return findings
    .map(({ severity, area, message, route }) => ({ severity, area, message, route }))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function sandboxManifestMatches(value: unknown) {
  return stableJson(value) === stableJson(expectedSiteSandboxManifest);
}

function isRepairableSandboxBuildError(error: unknown) {
  return error instanceof SiteSandboxRequestError
    && error.status === 422
    && (error.providerCode === "build_failed" || error.providerCode === "source_policy_violation");
}

function platformTerminalError(error: unknown): SiteAuthoringTerminalError {
  if (isSiteAuthoringTerminalError(error)) return error;
  if (error instanceof SiteSandboxArtifactContractError) {
    return new SiteAuthoringTerminalError(
      "artifact_contract_invalid",
      "platform",
      false,
      error.message,
      { cause: error }
    );
  }
  if (error instanceof SiteSandboxRequestError) {
    const code = error.providerCode === "artifact_not_built"
      ? "artifact_contract_invalid" as const
      : "sandbox_unavailable" as const;
    return new SiteAuthoringTerminalError(code, "platform", false, error.message, { cause: error });
  }
  if (/abort|deadline|timed out/i.test(failureMessage(error))) {
    return new SiteAuthoringTerminalError("deadline_exhausted", "budget", false, failureMessage(error), { cause: error });
  }
  return new SiteAuthoringTerminalError(
    "unknown_internal_failure",
    "platform",
    false,
    failureMessage(error),
    { cause: error }
  );
}

function lazyExternalClient<T extends object>(factory: () => T): T {
  let client: T | undefined;
  return new Proxy({} as T, {
    get(_target, property) {
      client ??= factory();
      const value = Reflect.get(client, property);
      return typeof value === "function" ? value.bind(client) : value;
    }
  });
}

function failureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 2000 ? message : `${message.slice(0, 1980)}... [truncated]`;
}

function candidateOutbox(artifact: SiteBuildArtifact, version: SiteVersion) {
  const createdAt = new Date().toISOString();
  return authoringOutboxEventSchema.parse({
    schemaVersion: 1,
    id: deterministicId("authoring_outbox", { schemaVersion: 1, candidateVersionId: version.id }),
    eventType: "site_candidate_finalized",
    aggregateId: version.id,
    payload: {
      siteId: version.siteId,
      artifactId: artifact.id,
      candidateVersionId: version.id
    },
    status: "pending",
    attempts: 0,
    runAfter: createdAt,
    createdAt
  });
}
