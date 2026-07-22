import { randomBytes, randomUUID } from "node:crypto";
import { createPublicBuildInput, assertNoPrivateBuildInputFields, ingestWebsite, sha256, stableJson } from "@/packages/business-data";
import { sitePlatformRepository, type SitePlatformRepository } from "@/packages/platform-data";
import {
  configuredArtifactBlobStore,
  persistFinalArtifact,
  serializeWorkspaceSourceSidecar,
  workspaceSourceSidecarKey,
  workspaceSourceSidecarV1Schema,
  type ArtifactBlobStore,
  type WorkspaceSourceSidecarV1
} from "@/packages/site-artifacts";
import { WebsiteManagerAgent, taskSkillFor, websiteManagerPromptVersion, workspaceSourceFileSchema, type ManagerRunRequestV3, type WorkspaceSourceFile } from "@/packages/site-agent";
import { configuredSiteSandboxClient, type SiteSandboxClient } from "@/packages/site-sandbox";
import { unsupportedCapabilityDemands, unsupportedCapabilityMessage } from "@/packages/site-capabilities";
import {
  agenticSitePlatformVersion,
  operatorQueueItemSchema,
  siteAgentRunV2Schema,
  siteAgentSessionV1Schema,
  siteEditObjectiveV1Schema,
  siteVersionV4Schema,
  siteWorkspaceRevisionV1Schema,
  verticalDemandEventV1Schema,
  type SiteAgentRunV2,
  type SiteAgentSessionV1,
  type SiteBuildArtifactV1,
  type SiteElementSelectionV1,
  type SiteEditObjectiveV1,
  type SitePublicBuildInputV3,
  type SiteVersionV4,
  type SiteWorkspaceRevisionV1
} from "@/packages/site-contracts";
import { sandboxImageDigest, siteToolchainVersion } from "@/packages/site-contracts/platform-versions";
import {
  finalizePreparedArtifact,
  applyEditObjective,
  createArtifactContactSheet,
  prepareSiteArtifact,
  runArtifactBrowserGate
} from "@/packages/site-verification";
import { createSiteRuntimePatch } from "@/packages/trusted-runtime";
import { platformOperationsRepository, type PlatformOperationsRepository } from "@/packages/platform-operations";
import { WorkspaceManagerRuntimeV3, type RuntimeInspectionV3 } from "./manager-runtime";
import { deriveSitePublicationReadiness } from "./publication-readiness";
import { SiteAgentTraceRecorderV1 } from "./trace-recorder";

const runtimeSeriesId = "site-runtime-v1";
export { agenticSitePlatformVersion, siteToolchainVersion };
const idleLeaseMs = 10 * 60_000;
const rotationMs = 2 * 60 * 60_000;
export const initialGenerationDeadlineMs = 60 * 60_000;
export const siteEditDeadlineMs = 25 * 60_000;

export class AgenticSiteWorkflowV1 {
  constructor(
    private readonly repository: SitePlatformRepository = sitePlatformRepository,
    private readonly blobStore: ArtifactBlobStore = lazyExternalClient(configuredArtifactBlobStore),
    private readonly sandbox: SiteSandboxClient = lazyExternalClient(configuredSiteSandboxClient),
    private readonly manager = new WebsiteManagerAgent(),
    private readonly operationsRepository: PlatformOperationsRepository = platformOperationsRepository
  ) {}

  async bootstrapFromUrl(input: {
    url: string;
    ownerId: string;
    mode?: "draft" | "experimental";
    workspaceId?: string;
    slug?: string;
    signal?: AbortSignal;
  }) {
    const workflowStartedAt = new Date().toISOString();
    const workflowSignal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(initialGenerationDeadlineMs)])
      : AbortSignal.timeout(initialGenerationDeadlineMs);
    const existing = await this.findExistingBootstrap(input);
    if (existing) return existing;
    const ingested = await ingestWebsite({
      url: input.url,
      slug: input.slug,
      workspaceId: input.workspaceId,
      signal: workflowSignal
    });
    if (!ingested.domainContext) {
      const understanding = ingested.sourceSnapshots[0]?.payload.understanding as { observedCategory?: { value?: string } } | undefined;
      await this.repository.saveVerticalDemandEvent(verticalDemandEventV1Schema.parse({
        schemaVersion: "vertical-demand-event-v1",
        id: id("vertical_demand"),
        sourceUrl: input.url,
        observedVertical: understanding?.observedCategory?.value,
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
    const site = { ...ingested.site, status: input.mode === "experimental" ? "experimental" as const : ingested.site.status };
    await this.repository.bootstrapSite({
      site,
      state: ingested.state,
      intent: ingested.intent,
      forms: ingested.forms,
      sourceSnapshots: ingested.sourceSnapshots,
      assetRevisions: ingested.retainedAssets.map((asset) => asset.revision),
      publicBuildInput: buildInput
    });
    await this.ensureRuntime();
    const session = await this.getOrCreateSession({ siteId: site.id, ownerId: input.ownerId, buildInput });
    const run = await this.enqueueRun({
      session,
      kind: "initial_build",
      instruction: "Create the complete initial customer website from the canonical public business input.",
      requestedBy: input.ownerId,
      workflowStartedAt
    });
    return { site, session, run, buildInput };
  }

  async getOrCreateSession(input: { siteId: string; ownerId: string; buildInput?: SitePublicBuildInputV3 }) {
    const existing = await this.repository.getActiveAgentSession(input.siteId, input.ownerId);
    if (existing) return existing;
    const site = await this.repository.getSite(input.siteId);
    if (!site) throw new Error("Site not found.");
    const buildInputId = input.buildInput?.id ?? site.currentPublicBuildInputId;
    const buildInput = input.buildInput ?? (buildInputId ? await this.repository.getPublicBuildInput(buildInputId) : undefined);
    if (!buildInput) throw new Error("Site does not have a current public build input.");
    const now = new Date();
    const session = siteAgentSessionV1Schema.parse({
      schemaVersion: "site-agent-session-v1",
      id: id("session"),
      siteId: site.id,
      ownerId: input.ownerId,
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
    session: SiteAgentSessionV1;
    kind: SiteAgentRunV2["kind"];
    instruction: string;
    requestedBy: string;
    selection?: SiteElementSelectionV1;
    origin?: SiteAgentRunV2["origin"];
    deferBehindActive?: boolean;
    publishAfterSuccess?: boolean;
    workflowStartedAt?: string;
  }) {
    if (await this.repository.isMaintenanceLeaseActive("workspace_storage_cutover", new Date().toISOString())) {
      throw new Error("workspace_storage_cutover_active");
    }
    const unsupported = unsupportedCapabilityDemands(input.instruction);
    if (unsupported.length) {
      const now = new Date().toISOString();
      const message = unsupportedCapabilityMessage(unsupported)!;
      await this.repository.appendAgentMessage({
        id: id("message"), sessionId: input.session.id,
        role: input.requestedBy === input.session.ownerId ? "owner" : "operator",
        content: input.instruction, selection: input.selection, createdAt: now
      });
      await this.repository.appendAgentMessage({
        id: id("message"), sessionId: input.session.id, role: "system", content: message, createdAt: now
      });
      await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
        schemaVersion: "operator-queue-item-v2",
        id: id("operator"), siteId: input.session.siteId, reason: "unsupported_capability", severity: "normal", status: "open",
        findings: unsupported.map((finding) => ({ ...finding, instruction: input.instruction })), createdAt: now, updatedAt: now
      }));
      throw new Error(message);
    }
    const sessionRuns = await this.repository.listAgentRuns(input.session.id);
    const runningRun = sessionRuns.find((candidate) => candidate.status === "running");
    const queuedRun = sessionRuns.find((candidate) => candidate.status === "queued");
    const activeRun = runningRun ?? queuedRun;
    if (activeRun && !input.deferBehindActive) throw new Error(`Session already has an active run: ${activeRun.id}`);
    const current = await this.repository.getSite(input.session.siteId);
    if (!current) throw new Error("Site not found.");
    if (input.selection?.workspaceRevisionId && input.selection.workspaceRevisionId !== current.currentWorkspaceRevisionId) {
      throw new Error("stale_selection");
    }
    const buildInput = await this.requireBuildInput(input.session.publicBuildInputId);
    const now = new Date().toISOString();
    const taskSkill = taskSkillFor(input.kind);
    const coalesced = input.origin === "control_plane"
      ? sessionRuns.find((candidate) => candidate.status === "queued" && candidate.origin === "control_plane")
      : undefined;
    if (coalesced) {
      const kind = coalesced.kind === "page_edit" || input.kind === "page_edit" ? "page_edit" as const : "rebase" as const;
      const mergedSkill = taskSkillFor(kind);
      const updated = await this.updateRun(coalesced, {
        publicBuildInputId: buildInput.id,
        kind,
        exactParentRevisionId: current.currentWorkspaceRevisionId,
        deferredUntilRunId: runningRun?.id ?? coalesced.deferredUntilRunId,
        publishAfterSuccess: coalesced.publishAfterSuccess && Boolean(input.publishAfterSuccess) && kind === "rebase",
        skillVersions: {
          manager: websiteManagerPromptVersion,
          domainContext: buildInput.domainContext?.version ?? "none",
          [mergedSkill.id]: mergedSkill.version
        }
      });
      await this.repository.appendAgentMessage({
        id: id("message"), sessionId: input.session.id, runId: updated.id,
        role: input.requestedBy === input.session.ownerId ? "owner" : "operator",
        content: input.instruction, selection: input.selection, createdAt: now
      });
      return updated;
    }
    const run = siteAgentRunV2Schema.parse({
      schemaVersion: "site-agent-run-v2",
      id: id("run"),
      sessionId: input.session.id,
      siteId: input.session.siteId,
      publicBuildInputId: buildInput.id,
      origin: input.origin ?? (input.kind === "initial_build" ? "system" : "owner_request"),
      requestedBy: input.requestedBy,
      publishAfterSuccess: Boolean(input.publishAfterSuccess),
      kind: input.kind,
      status: "queued",
      stage: "queued",
      exactParentRevisionId: current.currentWorkspaceRevisionId,
      deferredUntilRunId: input.deferBehindActive ? activeRun?.id : undefined,
      modelId: process.env.LODESTA_SITE_AGENT_MODEL ?? "configured-at-run",
      attempt: 0,
      skillVersions: {
        manager: websiteManagerPromptVersion,
        domainContext: buildInput.domainContext?.version ?? "none",
        [taskSkill.id]: taskSkill.version
      },
      attempts: [],
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 },
      startedAt: input.workflowStartedAt ?? now
    });
    await this.repository.saveAgentRun(run);
    await this.repository.appendAgentMessage({
      id: id("message"),
      sessionId: input.session.id,
      runId: run.id,
      role: input.requestedBy === input.session.ownerId ? "owner" : "operator",
      content: input.instruction,
      selection: input.selection,
      createdAt: now
    });
    return run;
  }

  async preflightAndEnqueueApply(input: {
    session: SiteAgentSessionV1;
    instruction: string;
    requestedBy: string;
    selection?: SiteElementSelectionV1;
    signal?: AbortSignal;
  }) {
    const unsupported = unsupportedCapabilityDemands(input.instruction);
    if (unsupported.length) throw new Error(unsupportedCapabilityMessage(unsupported)!);
    const site = await this.repository.getSite(input.session.siteId);
    if (!site) throw new Error("Site not found.");
    if (input.selection?.workspaceRevisionId && input.selection.workspaceRevisionId !== site.currentWorkspaceRevisionId) throw new Error("stale_selection");
    const versions = await this.repository.listSiteVersions(site.id);
    const currentVersion = versions.find((version) => version.workspaceRevisionId === site.currentWorkspaceRevisionId) ?? versions.find((version) => version.status === "candidate" || version.status === "published");
    const artifact = currentVersion ? await this.repository.getBuildArtifact(currentVersion.artifactId) : undefined;
    const baselineRoutes = artifact?.routes.map((route) => route.path) ?? [];
    const baselineCapabilityBindings = artifact?.capabilityBindings.map(({ id: bindingId, kind, route }) => ({ id: bindingId, kind, route })) ?? [];
    const baselineCapabilities = baselineCapabilityBindings.map((binding) => binding.id);
    const formBindings = artifact?.capabilityBindings.filter((binding) => binding.kind === "form").map((binding) => ({ id: binding.id, route: binding.route })) ?? [];
    const requestId = id("apply_request");
    const recorder = new SiteAgentTraceRecorderV1(this.repository, this.blobStore, requestId, { sessionId: input.session.id, requestId });
    const span = await recorder.open({ kind: "preflight", name: "edit_objective_preflight", summary: { routeCount: baselineRoutes.length, hasSelection: Boolean(input.selection) } });
    let result;
    try {
      result = await this.manager.preflightEdit({
        instruction: input.instruction,
        selection: input.selection,
        routes: baselineRoutes,
        capabilityIds: baselineCapabilities,
        formBindings,
        signal: input.signal
      });
      await recorder.close(span, {
        status: "succeeded",
        modelId: result.modelId,
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        outputTokens: result.usage.outputTokens,
        summary: { decision: result.preflight.decision, taskKind: result.preflight.taskKind, operation: result.preflight.operation },
        payload: { instruction: input.instruction, selection: input.selection, result: result.preflight }
      });
    } catch (error) {
      await recorder.close(span, { status: "failed", errorCode: failureCode(error), summary: { error: failureMessage(error) } });
      throw new EditPreflightFailedError(failureMessage(error));
    }
    if (result.preflight.decision === "clarification_required") {
      throw new EditClarificationRequiredError(result.preflight.clarificationQuestion!);
    }
    if (result.preflight.operation === "move_form" && formBindings.length === 0) {
      throw new EditClarificationRequiredError("This site does not currently have a form to move. Which form should be added, and where should it go?");
    }
    const taskKind = result.preflight.taskKind!;
    const run = await this.enqueueRun({ session: input.session, kind: taskKind, instruction: input.instruction, requestedBy: input.requestedBy, selection: input.selection });
    const ownerSpecifiedRoutes = exactRoutesIn(input.instruction);
    const checks: SiteEditObjectiveV1["checks"] = [
      ...baselineRoutes.map((route): SiteEditObjectiveV1["checks"][number] => ({ kind: "preserve_route", route })),
      ...baselineCapabilities.map((capabilityId): SiteEditObjectiveV1["checks"][number] => ({ kind: "preserve_capability", capabilityId }))
    ];
    if (result.preflight.operation === "add_page") {
      if (ownerSpecifiedRoutes.length) {
        for (const route of ownerSpecifiedRoutes) checks.push({ kind: "route_present", route });
      } else {
        checks.push({ kind: "new_route_count", minimum: 1 });
      }
      checks.push({ kind: "new_routes_navigable" });
    }
    if (result.preflight.operation === "move_form") checks.push({ kind: "form_binding_moved" });
    await this.repository.saveEditObjective(siteEditObjectiveV1Schema.parse({
      schemaVersion: "site-edit-objective-v1",
      id: id("objective"),
      runId: run.id,
      sessionId: input.session.id,
      siteId: site.id,
      requestId,
      instruction: input.instruction,
      taskKind,
      operation: result.preflight.operation!,
      requestedOutcome: result.preflight.requestedOutcome,
      selection: input.selection,
      baselineRoutes,
      baselineCapabilities,
      baselineCapabilityBindings,
      ownerSpecifiedRoutes,
      checks,
      producerVersion: "edit-objective-preflight-v1",
      modelId: result.modelId,
      createdAt: new Date().toISOString()
    }));
    return { run, objective: await this.repository.getEditObjective(run.id) };
  }

  async executeRun(runId: string, selection?: SiteElementSelectionV1) {
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
    let run: SiteAgentRunV2 = claimed;
    const deadlineAt = Date.parse(run.startedAt) + (run.kind === "initial_build" ? initialGenerationDeadlineMs : siteEditDeadlineMs);
    const remainingMs = deadlineAt - Date.now();
    try {
      if (remainingMs <= 0) throw new Error("workflow_deadline_exhausted");
      const workflowSignal = AbortSignal.timeout(remainingMs);
      const session = await this.requireSession(run.sessionId);
      const buildInput = await this.requireBuildInput(run.publicBuildInputId);
      const site = await this.repository.getSite(run.siteId);
      if (!site) throw new Error("Site not found.");
      if ((site.currentWorkspaceRevisionId ?? undefined) !== (run.exactParentRevisionId ?? undefined)) throw new Error("stale_parent_revision");
      if (run.kind === "rebase") {
        const sandboxState = await this.ensureSandbox(session, buildInput);
        return await this.executeDeterministicRebase({ run, session: sandboxState.session, buildInput, sandboxRevision: sandboxState.revision, signal: workflowSignal });
      }
      const currentFiles = run.kind === "initial_build"
        ? undefined
        : await this.loadWorkspaceSource(site.currentWorkspaceRevisionId);
      const expectedRoutes = run.kind === "initial_build" ? undefined : await this.currentWorkspaceRoutes(run.siteId, site.currentWorkspaceRevisionId);
      const objective = await this.repository.getEditObjective(run.id);
      const requestMessages = (await this.repository.listAgentMessages(session.id)).filter((message) => message.runId === run.id && (message.role === "owner" || message.role === "operator"));
      const ownerMessage = requestMessages.map((message) => message.content).join("\n\n")
        || "Apply the requested site change.";
      let repairUsed = false;
      let subjectiveRepairFailure: string | undefined;
      let outcome;
      const firstStartedAt = new Date().toISOString();
      try {
        outcome = await this.runAttempt({
          run,
          session,
          buildInput,
          sandboxRevision: "deferred",
          currentFiles,
          instruction: ownerMessage,
          selection: selection ?? requestMessages.find((message) => message.selection)?.selection,
          kind: run.kind,
          objective,
          expectedRoutes,
          signal: workflowSignal
        });
        run = outcome.run;
      } catch (error) {
        const latest = await this.requireRun(run.id);
        if (!isRepairableWorkspaceFailure(error, latest.stage)) throw error;
        run = latest;
        repairUsed = true;
        const failedSession = await this.requireSession(run.sessionId);
        const failedAttempt = await this.captureFailedAttempt({
          runId: run.id,
          session: failedSession,
          kind: run.kind,
          startedAt: firstStartedAt,
          error
        });
        run = failedAttempt.run;
        const repairStartedAt = new Date().toISOString();
        try {
          outcome = await this.runAttempt({
            run,
            session: failedSession,
            buildInput,
            sandboxRevision: failedAttempt.sandboxRevision,
            currentFiles: failedAttempt.files,
            instruction: "Repair the workspace validation or build failure without changing supported facts, route intent, or unrelated design decisions.",
            objectiveFindings: [failedAttempt.diagnostic],
            kind: "qa_repair",
            objective,
            expectedRoutes,
            signal: workflowSignal
          });
          run = outcome.run;
        } catch (repairError) {
          const latest = await this.requireRun(run.id);
          run = latest;
          if (isRepairableWorkspaceFailure(repairError, latest.stage)) {
            const repairSession = await this.requireSession(run.sessionId);
            await this.captureFailedAttempt({
              runId: run.id,
              session: repairSession,
              kind: "qa_repair",
              startedAt: repairStartedAt,
              error: repairError
            });
          }
          throw repairError;
        }
      }
      if (!repairUsed && outcome.artifact.qa.hardGate === "failed") {
        repairUsed = true;
        outcome = await this.runAttempt({
          run,
          session: outcome.session,
          buildInput,
          sandboxRevision: outcome.sandboxRevision,
          currentFiles: outcome.files,
          instruction: "Repair the objective gate failures without changing supported facts, route intent, or unrelated design decisions.",
          objectiveFindings: outcome.artifact.qa.findings.filter((finding) => finding.severity === "error").map((finding) => `${finding.route ?? "/"}: ${finding.message}`),
          kind: "qa_repair",
          objective,
          expectedRoutes: outcome.artifact.routes.map((route) => route.path),
          signal: workflowSignal
        });
        run = outcome.run;
      } else if (!repairUsed && outcome.criticAvailable && outcome.subjectiveReview.verdict === "revise") {
        repairUsed = true;
        const passingOutcome = outcome;
        const repairStartedAt = new Date().toISOString();
        try {
          outcome = await this.runAttempt({
            run,
            session: passingOutcome.session,
            buildInput,
            sandboxRevision: passingOutcome.sandboxRevision,
            currentFiles: passingOutcome.files,
            instruction: "Resolve the read-only visual critic's concrete findings without changing verified facts, supported capabilities, or unrelated design decisions.",
            objectiveFindings: passingOutcome.subjectiveReview.findings.map((finding) => `${finding.route}: ${finding.message}`),
            kind: "qa_repair",
            objective,
            expectedRoutes: passingOutcome.artifact.routes.map((route) => route.path),
            signal: workflowSignal
          });
          run = outcome.run;
        } catch (repairError) {
          subjectiveRepairFailure = failureMessage(repairError);
          const latest = await this.requireRun(run.id);
          const failedAttempt = await this.captureFailedAttempt({
            runId: run.id,
            session: passingOutcome.session,
            kind: "qa_repair",
            startedAt: repairStartedAt,
            error: repairError
          }).catch(() => undefined);
          run = failedAttempt?.run ?? latest;
          outcome = await this.restorePassingOutcome({
            outcome: { ...passingOutcome, run },
            currentSandboxRevision: failedAttempt?.sandboxRevision
          });
        }
      }
      if (outcome.artifact.qa.hardGate === "failed") {
        await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
          schemaVersion: "operator-queue-item-v2",
          id: id("operator"), siteId: run.siteId, runId: run.id,
          reason: "objective_failure", severity: "high", status: "open",
          findings: outcome.artifact.qa.findings,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }));
        throw new Error("Candidate failed the objective gate after one repair.");
      }
      const version = await this.createCandidateVersion(outcome.artifact, outcome.revision.id, buildInput, run);
      if (outcome.subjectiveReview.verdict === "revise") {
        await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
          schemaVersion: "operator-queue-item-v2",
          id: id("operator"), siteId: run.siteId, runId: run.id, versionId: version.id,
          reason: "subjective_finding", severity: outcome.criticAvailable ? "normal" : "high", status: "open",
          findings: [{ message: outcome.subjectiveReview.summary, repairUsed, subjectiveRepairFailure }, ...outcome.subjectiveReview.findings],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }));
      }
      run = await this.updateRun(run, {
        status: "succeeded",
        stage: "candidate_ready",
        fastPreviewPath: undefined,
        outputRevisionId: outcome.revision.id,
        candidateVersionId: version.id,
        completedAt: new Date().toISOString()
      });
      await this.repository.appendAgentMessage({
        id: id("message"), sessionId: run.sessionId, runId: run.id, role: "agent",
        content: outcome.ownerMessage, createdAt: new Date().toISOString()
      });
      await this.destroySessionSandbox(outcome.session, {
        reason: "terminal_run_success",
        currentWorkspaceRevisionId: outcome.revision.id
      });
      return run;
    } catch (error) {
      if (Date.now() >= deadlineAt) error = new Error("workflow_deadline_exhausted");
      const latest = await this.repository.getAgentRun(run.id) ?? run;
      await this.repository.failOpenTraceSpans(run.id, new Date().toISOString(), failureCode(error)).catch(() => undefined);
      await this.checkpointAfterRunFailure(latest).catch(() => undefined);
      await this.queueTerminalRunFailure(latest, error).catch(() => undefined);
      const failed = await this.updateRun(latest, {
        status: "failed",
        stage: "failed",
        fastPreviewPath: undefined,
        failureReason: failureMessage(error),
        completedAt: new Date().toISOString()
      });
      return failed;
    }
  }

  async executeRunAndFinalize(runId: string, selection?: SiteElementSelectionV1) {
    const run = await this.executeRun(runId, selection);
    if (!run.publishAfterSuccess || run.status !== "succeeded" || !run.candidateVersionId) return run;
    const site = await this.repository.getSite(run.siteId);
    if (site?.currentPublicBuildInputId !== run.publicBuildInputId) return run;
    try {
      await this.promoteVersion(run.candidateVersionId, run.requestedBy);
    } catch (error) {
      const now = new Date().toISOString();
      await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
        schemaVersion: "operator-queue-item-v2",
        id: id("operator"), siteId: run.siteId, versionId: run.candidateVersionId, runId: run.id,
        reason: "stale_candidate", severity: "urgent", status: "open",
        findings: [{ message: error instanceof Error ? error.message : String(error) }],
        createdAt: now, updatedAt: now
      }));
    }
    return run;
  }

  async discuss(input: {
    sessionId: string;
    ownerId: string;
    message: string;
    selection?: SiteElementSelectionV1;
    signal?: AbortSignal;
  }) {
    const session = await this.requireSession(input.sessionId);
    if (session.ownerId !== input.ownerId) throw new Error("Session owner mismatch.");
    const buildInput = await this.requireBuildInput(session.publicBuildInputId);
    const source = session.currentWorkspaceRevisionId ? await this.loadWorkspaceSource(session.currentWorkspaceRevisionId) : undefined;
    await this.repository.appendAgentMessage({
      id: id("message"), sessionId: session.id, role: "owner", content: input.message,
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
      id: id("message"), sessionId: session.id, role: "agent", content: result.discussion.response,
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
    const queued = await this.repository.listQueuedAgentRuns(limit);
    const processed: SiteAgentRunV2[] = [];
    for (const run of queued) processed.push(await this.executeRunAndFinalize(run.id));
    const maintenanceNow = new Date();
    const maintenanceToken = sha256(randomBytes(32));
    const ownsTraceCleanup = await this.repository.acquireMaintenanceLease(
      "trace_payload_cleanup",
      maintenanceToken,
      maintenanceNow.toISOString(),
      new Date(maintenanceNow.getTime() + 60 * 60_000).toISOString()
    );
    let expiredTracePayloads: string[] = [];
    if (ownsTraceCleanup) {
      try {
        expiredTracePayloads = await this.sweepExpiredTracePayloads(limit * 25);
      } finally {
        await this.repository.releaseMaintenanceLease("trace_payload_cleanup", maintenanceToken);
      }
    }
    return { reaped, recovered, processed, expiredTracePayloads };
  }

  async sweepExpiredTracePayloads(limit = 100) {
    const now = new Date();
    const expired = await this.repository.listExpiredTracePayloads(now.toISOString(), Math.max(1, Math.min(limit, 500)));
    const cleared: string[] = [];
    for (const span of expired) {
      if (!span.payloadRef) continue;
      if (!(await this.blobStore.exists(span.payloadRef))) {
        cleared.push(span.id);
        continue;
      }
      if (!span.payloadExpiresAt || Date.parse(span.payloadExpiresAt) > now.getTime() - 48 * 60 * 60_000 || !span.runId) continue;
      const run = await this.repository.getAgentRun(span.runId);
      if (!run) continue;
      const existing = (await this.repository.listOperatorQueue()).some((item) =>
        item.reason === "maintenance_failure"
        && item.runId === run.id
        && item.status !== "resolved"
        && item.status !== "dismissed"
        && item.findings.some((finding) => finding.payloadRef === span.payloadRef)
      );
      if (!existing) {
        const timestamp = now.toISOString();
        await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
          schemaVersion: "operator-queue-item-v2",
          id: id("operator"),
          siteId: run.siteId,
          runId: run.id,
          reason: "maintenance_failure",
          severity: "normal",
          status: "open",
          findings: [{ kind: "trace_payload_lifecycle_delay", spanId: span.id, payloadRef: span.payloadRef, payloadExpiresAt: span.payloadExpiresAt }],
          createdAt: timestamp,
          updatedAt: timestamp
        }));
      }
    }
    await this.repository.clearTracePayloads(cleared);
    return cleared;
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
    const objective = await this.repository.getEditObjective(failed.id);
    if (objective) {
      await this.repository.saveEditObjective(siteEditObjectiveV1Schema.parse({
        ...objective,
        id: id("objective"),
        runId: retried.id,
        requestId: id("retry_request"),
        createdAt: new Date().toISOString()
      }));
    }
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
    let session = await this.getOrCreateSession({ siteId: site.id, ownerId: actorId, buildInput });
    session = siteAgentSessionV1Schema.parse({ ...session, publicBuildInputId: buildInput.id, updatedAt: new Date().toISOString() });
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

  private async runAttempt(input: {
    run: SiteAgentRunV2;
    session: SiteAgentSessionV1;
    buildInput: SitePublicBuildInputV3;
    sandboxRevision: string;
    currentFiles?: WorkspaceSourceFile[];
    instruction: string;
    selection?: SiteElementSelectionV1;
    objectiveFindings?: string[];
    objective?: SiteEditObjectiveV1;
    kind: ManagerRunRequestV3["kind"];
    expectedRoutes?: string[];
    signal?: AbortSignal;
  }) {
    let run = await this.updateRun(input.run, { stage: "authoring" });
    const recorder = new SiteAgentTraceRecorderV1(this.repository, this.blobStore, run.id, {
      runId: run.id,
      sessionId: run.sessionId,
      attemptIndex: run.attempts.length + 1
    });
    const attemptSpan = await recorder.open({
      kind: "attempt",
      name: input.kind,
      summary: { kind: input.kind, publicBuildInputId: input.buildInput.id, repair: input.kind === "qa_repair" }
    });
    const modelStarted = new Date().toISOString();
    const fastPreviewPath = `/api/site-agent/sessions/${input.session.id}/preview`;
    const baseUsage = { ...run.usage };
    let activeSession = input.session;
    let activeSandboxRevision = input.sandboxRevision;
    const ensureBuildSandbox = async () => {
      if (activeSession.sandboxId && activeSandboxRevision !== "deferred") return;
      const state = await this.ensureSandbox(activeSession, input.buildInput);
      activeSession = state.session;
      activeSandboxRevision = state.revision;
    };
    type Checkpoint = Awaited<ReturnType<AgenticSiteWorkflowV1["verifySandboxArtifact"]>> & {
      revision: ReturnType<typeof siteWorkspaceRevisionV1Schema.parse>;
    };
    const runtimeBudget = managerRuntimeBudget(input.kind);
    const runtime = new WorkspaceManagerRuntimeV3<Checkpoint>({
      kind: input.kind,
      publicBuildInputId: input.buildInput.id,
      toolchainVersion: siteToolchainVersion,
      sandboxImageDigest: configuredSandboxImageDigest(),
      initialFiles: input.currentFiles,
      initialSandboxRevision: input.sandboxRevision,
      maxBuilds: runtimeBudget.builds,
      maxInspections: runtimeBudget.inspections,
      applyBuild: async (files, expectedRevision) => {
        run = await this.updateRun(run, { stage: "building" });
        await ensureBuildSandbox();
        const revision = expectedRevision === "deferred" ? activeSandboxRevision : expectedRevision;
        const applied = await this.sandbox.apply(activeSession.sandboxId!, revision, files);
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
      inspect: async (files, sandboxRevision): Promise<RuntimeInspectionV3<Checkpoint>> => {
        run = await this.updateRun(run, { stage: "verifying" });
        const [backup, site] = await Promise.all([
          this.sandbox.backup(activeSession.sandboxId!),
          this.repository.getSite(run.siteId)
        ]);
        if (!site) throw new Error("Site not found.");
        const parent = site.currentWorkspaceRevisionId ? await this.repository.getWorkspaceRevision(site.currentWorkspaceRevisionId) : undefined;
        const revision = siteWorkspaceRevisionV1Schema.parse({
          schemaVersion: "site-workspace-revision-v1",
          id: id("workspace_revision"),
          siteId: run.siteId,
          parentRevisionId: site.currentWorkspaceRevisionId,
          revisionNumber: (parent?.revisionNumber ?? 0) + 1,
          sourceHash: sha256(stableJson(files)),
          sourceArchiveKey: backup.backup.key,
          files: files.map((file) => ({ path: file.path, contentHash: sha256(file.content), bytes: Buffer.byteLength(file.content) })),
          createdAt: new Date().toISOString(),
          createdBy: { kind: "agent", id: run.id }
        });
        await this.persistWorkspaceSourceSidecar(revision, files, backup.backup);
        const finalized = await this.verifySandboxArtifact({
          run,
          session: activeSession,
          buildInput: input.buildInput,
          workspaceRevisionId: revision.id,
          expectedRoutes: input.expectedRoutes,
          objective: input.objective,
          taskInstruction: input.instruction,
          taskKind: input.kind,
          runSubjectiveCritic: false,
          signal: input.signal
        });
        const errors = finalized.artifact.qa.findings.filter((finding) => finding.severity === "error");
        const inspectionHash = sha256(stableJson({
          workspaceHash: revision.sourceHash,
          sandboxRevision,
          artifactHash: finalized.artifact.artifactHash,
          hardGate: finalized.artifact.qa.hardGate,
          findings: finalized.artifact.qa.findings,
          screenshotKeys: finalized.artifact.qa.screenshotKeys
        }));
        return {
          passed: finalized.artifact.qa.hardGate === "passed",
          inspectionHash,
          findingFingerprints: errors.map(findingFingerprint),
          objectiveChecks: finalized.objectiveChecks,
          modelSummary: {
            ok: finalized.artifact.qa.hardGate === "passed",
            workspaceHash: revision.sourceHash,
            sandboxRevision,
            publicBuildInputId: input.buildInput.id,
            toolchainVersion: siteToolchainVersion,
            sandboxImageDigest: configuredSandboxImageDigest(),
            inspectionHash,
            routes: finalized.artifact.routes,
            findings: errors.slice(0, 100).map((finding) => ({ ...finding, fingerprint: findingFingerprint(finding) }))
          },
          traceSummary: {
            ok: finalized.artifact.qa.hardGate === "passed",
            workspaceHash: revision.sourceHash,
            sandboxRevision,
            inspectionHash,
            artifactHash: finalized.artifact.artifactHash,
            findingCount: finalized.artifact.qa.findings.length,
            errorCount: errors.length,
            routeSimilarity: finalized.qualityMetrics.routeSimilarity,
            screenshotKeys: finalized.artifact.qa.screenshotKeys
          },
          images: finalized.contactSheet ? [{ type: "input_image", image_url: `data:image/png;base64,${finalized.contactSheet.toString("base64")}`, detail: "high" }] : undefined,
          checkpoint: finalized.artifact.qa.hardGate === "passed" ? { ...finalized, revision } : undefined
        };
      }
    });
    const managerResult = await this.manager.run({
      buildInput: input.buildInput,
      instruction: input.instruction,
      kind: input.kind,
      selection: input.selection,
      objectiveFindings: input.objectiveFindings,
      objective: input.objective,
      signal: input.signal,
      runtime,
      traceParentSpanId: attemptSpan.id,
      onTrace: async (events) => { await recorder.recordManagerEvents(events); },
      onPlanAccepted: async (sitePlan) => {
        run = await this.updateRun(run, { sitePlan });
      },
      onProgress: async ({ usage, modelId }) => {
        run = await this.updateRun(run, {
          modelId,
          usage: {
            inputTokens: baseUsage.inputTokens + usage.inputTokens,
            outputTokens: baseUsage.outputTokens + usage.outputTokens,
            estimatedCostUsd: baseUsage.estimatedCostUsd + usage.estimatedCostUsd,
            costEstimateStatus: baseUsage.costEstimateStatus === "configured" && usage.costEstimateStatus === "configured" ? "configured" : usage.costEstimateStatus,
            durationMs: baseUsage.durationMs + usage.durationMs
          }
        });
      }
    });
    const checkpoint = runtime.finalCheckpoint();
    const { revision } = checkpoint;
    const criticSpan = await recorder.open({ kind: "critic", name: "visual_critic", parentSpanId: attemptSpan.id, summary: { routeCount: checkpoint.artifact.routes.length } });
    const critic = await this.manager.critiqueCandidate({
      buildInput: input.buildInput,
      visualThesis: managerResult.completion.visualThesis,
      contentArchitecture: managerResult.completion.contentArchitecture,
      taskInstruction: input.instruction,
      taskKind: input.kind,
      routes: checkpoint.artifact.routes.map(({ path, title, description }) => ({ path, title, description })),
      contactSheet: checkpoint.contactSheet,
      homepageDesktop: checkpoint.browserCaptures.find((capture) => capture.route === "/" && capture.viewport === "desktop")?.bytes,
      homepageMobile: checkpoint.browserCaptures.find((capture) => capture.route === "/" && capture.viewport === "mobile")?.bytes,
      signal: input.signal
    }).then(async (value) => {
      await recorder.close(criticSpan, {
        status: "succeeded",
        modelId: value.modelId,
        inputTokens: value.usage.inputTokens,
        cachedInputTokens: value.usage.cachedInputTokens,
        outputTokens: value.usage.outputTokens,
        summary: { verdict: value.critique.verdict, findingCount: value.critique.findings.length },
        payload: {
          request: {
            taskInstruction: input.instruction,
            taskKind: input.kind,
            visualThesis: managerResult.completion.visualThesis,
            contentArchitecture: managerResult.completion.contentArchitecture,
            routes: checkpoint.artifact.routes.map(({ path, title, description }) => ({ path, title, description })),
            contactSheetIncluded: Boolean(checkpoint.contactSheet)
          },
          critique: value.critique
        }
      });
      return { ...value, available: true as const };
    }, async (error) => {
      await recorder.close(criticSpan, { status: "failed", errorCode: failureCode(error), summary: { error: failureMessage(error) } });
      return {
      critique: {
        schemaVersion: "manager-candidate-critique-v1" as const,
        verdict: "revise" as const,
        summary: "Automated visual review was unavailable; an operator must inspect the candidate before publishing.",
        findings: [{ route: "/", area: "craft" as const, severity: "high" as const, message: failureMessage(error).slice(0, 600) }]
      },
      modelId: "unavailable",
      promptVersion: "manager-visual-critic-v1",
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable" as const, durationMs: 0 },
      available: false as const
    }; });
    const subjectiveReview = {
      verdict: critic.critique.verdict,
      summary: critic.critique.summary,
      findings: critic.critique.findings,
      modelId: critic.modelId,
      promptVersion: critic.promptVersion,
      checkedAt: new Date().toISOString()
    };
    const finalized = checkpoint;
    run = await this.updateRun(run, {
      usage: {
        inputTokens: run.usage.inputTokens + critic.usage.inputTokens,
        outputTokens: run.usage.outputTokens + critic.usage.outputTokens,
        estimatedCostUsd: run.usage.estimatedCostUsd + critic.usage.estimatedCostUsd,
        costEstimateStatus: run.usage.costEstimateStatus === "configured" && critic.usage.costEstimateStatus === "configured" ? "configured" : "unavailable",
        durationMs: run.usage.durationMs + critic.usage.durationMs
      },
      visualThesis: managerResult.completion.visualThesis,
      contentArchitecture: managerResult.completion.contentArchitecture,
      sitePlan: managerResult.sitePlan,
      subjectiveReview,
      attempts: [...run.attempts, {
        number: run.attempts.length + 1,
        kind: input.kind,
        artifactId: finalized.artifact.id,
        workspaceRevisionId: revision.id,
        sourceArchiveKey: revision.sourceArchiveKey,
        screenshotKeys: finalized.artifact.qa.screenshotKeys,
        objectiveFindings: finalized.artifact.qa.findings.filter((finding) => finding.severity === "error").slice(0, 100),
        hardGate: finalized.artifact.qa.hardGate,
        objectiveErrorCount: finalized.artifact.qa.findings.filter((finding) => finding.severity === "error").length,
        subjectiveVerdict: subjectiveReview.verdict,
        criticAvailable: critic.available,
        modelDurationMs: managerResult.usage.durationMs + critic.usage.durationMs,
        buildDurationMs: managerResult.traces.filter((trace) => trace.name === "build_preview").reduce((total, trace) => total + Number(trace.output.buildDurationMs ?? 0), 0),
        startedAt: modelStarted,
        completedAt: new Date().toISOString()
      }]
    });
    await recorder.close(attemptSpan, {
      status: "succeeded",
      inputTokens: managerResult.usage.inputTokens + critic.usage.inputTokens,
      cachedInputTokens: managerResult.usage.cachedInputTokens + critic.usage.cachedInputTokens,
      outputTokens: managerResult.usage.outputTokens + critic.usage.outputTokens,
      summary: {
        hardGate: finalized.artifact.qa.hardGate,
        subjectiveVerdict: subjectiveReview.verdict,
        workspaceRevisionId: revision.id,
        artifactId: finalized.artifact.id
      }
    });
    let session = activeSession;
    if (finalized.artifact.qa.hardGate === "passed") {
      await persistFinalArtifact({ artifact: finalized.artifact, files: finalized.files, store: this.blobStore });
      await this.repository.commitVerifiedBuild({ revision, artifact: finalized.artifact });
      session = siteAgentSessionV1Schema.parse({
        ...activeSession,
        status: "active",
        currentWorkspaceRevisionId: revision.id,
        leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(),
        updatedAt: new Date().toISOString()
      });
      await this.repository.saveAgentSession(session);
    }
    return {
      run,
      session,
      sandboxRevision: managerResult.completion.sandboxRevision,
      files: runtime.currentFiles(),
      revision,
      artifact: finalized.artifact,
      subjectiveReview,
      criticAvailable: critic.available,
      ownerMessage: managerResult.completion.ownerMessage
    };
  }

  private async captureFailedAttempt(input: {
    runId: string;
    session: SiteAgentSessionV1;
    kind: ManagerRunRequestV3["kind"];
    startedAt: string;
    error: unknown;
  }) {
    const latest = await this.requireRun(input.runId);
    if (latest.attempts.length >= 2) throw input.error;
    const diagnostic = failureMessage(input.error);
    const source = await this.sandbox.getSource(input.session.sandboxId!);
    const files = source.files.map((file) => workspaceSourceFileSchema.parse(file));
    const run = await this.updateRun(latest, {
      attempts: [...latest.attempts, {
        number: latest.attempts.length + 1,
        kind: input.kind,
        hardGate: "failed",
        objectiveErrorCount: 1,
        subjectiveVerdict: "revise",
        criticAvailable: false,
        failureStage: repairFailureStage(latest.stage),
        failureReason: diagnostic,
        modelDurationMs: Math.max(0, Date.now() - Date.parse(input.startedAt)),
        buildDurationMs: 0,
        startedAt: input.startedAt,
        completedAt: new Date().toISOString()
      }]
    });
    return { run, files, sandboxRevision: source.revision, diagnostic };
  }

  private async restorePassingOutcome<T extends {
    session: SiteAgentSessionV1;
    sandboxRevision: string;
    files: WorkspaceSourceFile[];
    revision: ReturnType<typeof siteWorkspaceRevisionV1Schema.parse>;
  }>(input: { outcome: T; currentSandboxRevision?: string }): Promise<T> {
    const sandboxId = input.outcome.session.sandboxId;
    const backupId = input.outcome.revision.sourceArchiveKey.match(/^workspace-backups\/([a-f0-9]{64})\.tar\.gz$/)?.[1];
    if (sandboxId && backupId && input.currentSandboxRevision) {
      try {
        const sidecar = await this.loadWorkspaceSidecar(input.outcome.revision);
        const restored = await this.sandbox.restore(sandboxId, backupId, input.currentSandboxRevision, sidecar.archiveHash);
        const source = await this.sandbox.getSource(sandboxId);
        return { ...input.outcome, sandboxRevision: restored.revision, files: source.files.map((file) => workspaceSourceFileSchema.parse(file)) };
      } catch {
        const result = await this.destroySessionSandbox(input.outcome.session, {
          reason: "passing_outcome_restore_failed",
          currentWorkspaceRevisionId: input.outcome.revision.id
        });
        return { ...input.outcome, session: result.session };
      }
    }
    const result = await this.destroySessionSandbox(input.outcome.session, {
      reason: "passing_outcome_checkpoint",
      currentWorkspaceRevisionId: input.outcome.revision.id
    });
    return { ...input.outcome, session: result.session };
  }

  private async executeDeterministicRebase(input: {
    run: SiteAgentRunV2;
    session: SiteAgentSessionV1;
    buildInput: SitePublicBuildInputV3;
    sandboxRevision: string;
    signal: AbortSignal;
  }) {
    let run = await this.updateRun(input.run, { stage: "building" });
    const recorder = new SiteAgentTraceRecorderV1(this.repository, this.blobStore, run.id, { runId: run.id, sessionId: run.sessionId, attemptIndex: run.attempts.length + 1 });
    const attemptSpan = await recorder.open({ kind: "attempt", name: "rebase", summary: { publicBuildInputId: input.buildInput.id } });
    const assertWithinDeadline = () => {
      if (input.signal.aborted) throw new Error("workflow_deadline_exhausted");
    };
    try {
      assertWithinDeadline();
      const toolSpan = await recorder.open({ kind: "tool_call", name: "rebase_public_input", parentSpanId: attemptSpan.id, summary: { inputHash: input.buildInput.inputHash } });
      const rebased = await this.sandbox.rebase(input.session.sandboxId!, input.sandboxRevision, input.buildInput);
      assertWithinDeadline();
      await recorder.close(toolSpan, { status: "succeeded", summary: { revision: rebased.revision }, payload: { input: { expectedRevision: input.sandboxRevision, inputHash: input.buildInput.inputHash }, output: rebased } });
      run = await this.updateRun(run, { stage: "fast_preview", fastPreviewPath: `/api/site-agent/sessions/${input.session.id}/preview` });
      const [source, backup, site] = await Promise.all([
        this.sandbox.getSource(input.session.sandboxId!), this.sandbox.backup(input.session.sandboxId!), this.repository.getSite(run.siteId)
      ]);
      assertWithinDeadline();
      if (!site) throw new Error("Site not found.");
      const parent = site.currentWorkspaceRevisionId ? await this.repository.getWorkspaceRevision(site.currentWorkspaceRevisionId) : undefined;
      const files = source.files.map((file) => workspaceSourceFileSchema.parse(file));
      const revision = siteWorkspaceRevisionV1Schema.parse({
        schemaVersion: "site-workspace-revision-v1", id: id("workspace_revision"), siteId: run.siteId,
        parentRevisionId: site.currentWorkspaceRevisionId, revisionNumber: (parent?.revisionNumber ?? 0) + 1,
        sourceHash: sha256(stableJson(files)), sourceArchiveKey: backup.backup.key,
        files: files.map((file) => ({ path: file.path, contentHash: sha256(file.content), bytes: Buffer.byteLength(file.content) })),
        createdAt: new Date().toISOString(), createdBy: { kind: "system", id: run.id }
      });
      await this.persistWorkspaceSourceSidecar(revision, files, backup.backup);
      run = await this.updateRun(run, { stage: "verifying" });
      const inspectionSpan = await recorder.open({ kind: "inspection", name: "deterministic_rebase_verification", parentSpanId: attemptSpan.id, summary: { workspaceRevisionId: revision.id } });
      const finalized = await this.verifySandboxArtifact({
        run, session: input.session, buildInput: input.buildInput, workspaceRevisionId: revision.id, runSubjectiveCritic: false, signal: input.signal
      });
      assertWithinDeadline();
      await recorder.close(inspectionSpan, { status: finalized.artifact.qa.hardGate === "passed" ? "succeeded" : "failed", summary: { hardGate: finalized.artifact.qa.hardGate, findingCount: finalized.artifact.qa.findings.length }, payload: { findings: finalized.artifact.qa.findings }, errorCode: finalized.artifact.qa.hardGate === "failed" ? "objective_gate_failed" : undefined });
      run = await this.updateRun(run, { subjectiveReview: finalized.subjectiveReview });
      if (finalized.artifact.qa.hardGate === "failed") {
        await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
          schemaVersion: "operator-queue-item-v2",
          id: id("operator"), siteId: run.siteId, runId: run.id, reason: "objective_failure", severity: "high", status: "open",
          findings: finalized.artifact.qa.findings, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }));
        throw new Error("Deterministic recompile failed the objective gate.");
      }
      await persistFinalArtifact({ artifact: finalized.artifact, files: finalized.files, store: this.blobStore });
      await this.repository.commitVerifiedBuild({ revision, artifact: finalized.artifact });
      assertWithinDeadline();
      const session = siteAgentSessionV1Schema.parse({
        ...input.session, status: "active", currentWorkspaceRevisionId: revision.id,
        leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(), updatedAt: new Date().toISOString()
      });
      await this.repository.saveAgentSession(session);
      const version = await this.createCandidateVersion(finalized.artifact, revision.id, input.buildInput, run);
      run = await this.updateRun(run, {
        status: "succeeded", stage: "candidate_ready", fastPreviewPath: undefined, outputRevisionId: revision.id,
        candidateVersionId: version.id, completedAt: new Date().toISOString()
      });
      await recorder.close(attemptSpan, { status: "succeeded", summary: { workspaceRevisionId: revision.id, artifactId: finalized.artifact.id, candidateVersionId: version.id } });
      await this.repository.appendAgentMessage({
        id: id("message"), sessionId: run.sessionId, runId: run.id, role: "agent",
        content: "Recompiled the existing design against the updated verified business data. No model redesign was used.",
        createdAt: new Date().toISOString()
      });
      await this.destroySessionSandbox(session, { reason: "terminal_rebase_success", currentWorkspaceRevisionId: revision.id });
      return run;
    } catch (error) {
      const failure = input.signal.aborted ? new Error("workflow_deadline_exhausted") : error;
      await this.repository.failOpenTraceSpans(run.id, new Date().toISOString(), failureCode(failure)).catch(() => undefined);
      await this.checkpointAfterRunFailure(run).catch(() => undefined);
      await this.queueTerminalRunFailure(run, failure).catch(() => undefined);
      return this.updateRun(run, {
        status: "failed", stage: "failed", fastPreviewPath: undefined, failureReason: failureMessage(failure),
        completedAt: new Date().toISOString()
      });
    }
  }

  private async verifySandboxArtifact(input: {
    run: SiteAgentRunV2;
    session: SiteAgentSessionV1;
    buildInput: SitePublicBuildInputV3;
    workspaceRevisionId: string;
    runSubjectiveCritic?: boolean;
    expectedRoutes?: string[];
    objective?: SiteEditObjectiveV1;
    taskInstruction?: string;
    taskKind?: ManagerRunRequestV3["kind"];
    signal?: AbortSignal;
  }) {
    const authored = await this.sandbox.getArtifact(input.session.sandboxId!);
    const prepared = prepareSiteArtifact({ authoredArtifact: authored, buildInput: input.buildInput, runtimeSeriesId });
    for (const route of input.expectedRoutes ?? []) {
      if (!prepared.routes.some((candidate) => candidate.path === route)) {
        prepared.findings.push({ id: "route.regression", severity: "error", area: "route", route, message: `Existing route ${route} was removed by the edit.` });
      }
    }
    const objectiveChecks = input.objective ? applyEditObjective(prepared, input.objective) : [];
    const runtime = await this.ensureRuntime();
    const artifactId = id("artifact");
    const capturePrefix = `site-captures/${input.run.siteId}/${artifactId}`;
    const browserGate = await runArtifactBrowserGate({ prepared, buildInput: input.buildInput, blobStore: this.blobStore, capturePrefix, signal: input.signal });
    const contactSheet = await createArtifactContactSheet(browserGate.captures);
    const contactSheetKey = `${capturePrefix}/contact-sheet.png`;
    for (const capture of browserGate.captures) {
      await this.blobStore.putImmutable({ key: capture.key, bytes: capture.bytes, contentType: "image/png", contentHash: sha256(capture.bytes) });
    }
    await this.blobStore.putImmutable({ key: contactSheetKey, bytes: contactSheet, contentType: "image/png", contentHash: sha256(contactSheet) });
    const finalized = finalizePreparedArtifact({
      prepared, buildInput: input.buildInput, artifactId, workspaceRevisionId: input.workspaceRevisionId,
      runtimeSeriesId, runtimePatchId: runtime.patch.id, storagePrefix: `site-artifacts/${input.run.siteId}/${artifactId}`,
      toolchainVersion: siteToolchainVersion, sandboxImageDigest: configuredSandboxImageDigest(),
      browserGate: { findings: browserGate.findings, screenshotKeys: [...browserGate.captures.map((capture) => capture.key), contactSheetKey],
        routesChecked: browserGate.routesChecked, linksChecked: browserGate.linksChecked }
    });
    const critic = finalized.artifact.qa.hardGate === "passed" && input.runSubjectiveCritic !== false
      ? await this.manager.critiqueCandidate({
          buildInput: input.buildInput,
          visualThesis: input.run.visualThesis ?? prepared.authored.designRationale,
          contentArchitecture: input.run.contentArchitecture ?? prepared.routes.map((route) => `${route.path}: ${route.title}`).join("\n"),
          taskInstruction: input.taskInstruction ?? "Create a complete customer-ready website.",
          taskKind: input.taskKind ?? "initial_build",
          routes: prepared.routes.map(({ path, title, description }) => ({ path, title, description })),
          contactSheet,
          homepageDesktop: browserGate.captures.find((capture) => capture.route === "/" && capture.viewport === "desktop")?.bytes,
          homepageMobile: browserGate.captures.find((capture) => capture.route === "/" && capture.viewport === "mobile")?.bytes,
          signal: input.signal
        }).then((result) => ({ ...result, available: true as const }), (error) => ({
          critique: {
            schemaVersion: "manager-candidate-critique-v1" as const,
            verdict: "revise" as const,
            summary: "Automated visual review was unavailable; an operator must inspect the candidate before publishing.",
            findings: [{ route: "/", area: "craft" as const, severity: "high" as const, message: error instanceof Error ? error.message.slice(0, 600) : "Visual review failed." }]
          },
          modelId: "unavailable",
          promptVersion: "manager-visual-critic-v1",
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable" as const, durationMs: 0 },
          available: false as const
        }))
      : finalized.artifact.qa.hardGate === "passed"
        ? {
          critique: {
            schemaVersion: "manager-candidate-critique-v1" as const,
            verdict: "ship" as const,
            summary: "The existing reviewed design was deterministically recompiled; objective QA passed and no model redesign was used.",
            findings: []
          },
          modelId: "not_run_deterministic_rebase", promptVersion: "deterministic-rebase-v1",
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable" as const, durationMs: 0 },
          available: false as const
        }
        : {
          critique: { schemaVersion: "manager-candidate-critique-v1" as const, verdict: "revise" as const, summary: "Objective QA failed before visual review.", findings: [] },
          modelId: "not_run", promptVersion: "manager-visual-critic-v1",
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable" as const, durationMs: 0 },
          available: false as const
        };
    return {
      ...finalized,
      subjectiveReview: {
        verdict: critic.critique.verdict,
        summary: critic.critique.summary,
        findings: critic.critique.findings,
        modelId: critic.modelId,
        promptVersion: critic.promptVersion,
        checkedAt: new Date().toISOString()
      },
      criticUsage: critic.usage,
      criticAvailable: critic.available,
      objectiveChecks,
      contactSheet,
      browserCaptures: browserGate.captures
    };
  }

  private async createCandidateVersion(
    artifact: SiteBuildArtifactV1,
    workspaceRevisionId: string,
    buildInput: SitePublicBuildInputV3,
    run: SiteAgentRunV2
  ) {
    const versions = await this.repository.listSiteVersions(run.siteId);
    const version = siteVersionV4Schema.parse({
      schemaVersion: "site-version-v4",
      id: id("version"),
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
    await this.repository.createSiteVersion(version);
    return version;
  }

  private async currentWorkspaceRoutes(siteId: string, workspaceRevisionId: string | undefined) {
    if (!workspaceRevisionId) return [];
    const versions = await this.repository.listSiteVersions(siteId);
    const version = versions.find((candidate) => candidate.workspaceRevisionId === workspaceRevisionId);
    if (!version) throw new Error("Current workspace does not have a retained site version.");
    const artifact = await this.repository.getBuildArtifact(version.artifactId);
    if (!artifact) throw new Error("Current workspace does not have a retained build artifact.");
    return artifact.routes.map((route) => route.path);
  }

  private async findExistingBootstrap(input: { url: string; ownerId: string; mode?: "draft" | "experimental"; workspaceId?: string; slug?: string }) {
    const source = normalizedSourceUrl(input.url);
    for (const site of await this.repository.listSites()) {
      if (input.mode === "experimental" && site.status !== "experimental") continue;
      if (input.mode !== "experimental" && site.status === "experimental") continue;
      if (input.slug && site.slug !== input.slug) continue;
      if (input.workspaceId && site.workspaceId !== input.workspaceId) continue;
      if (!site.currentPublicBuildInputId) continue;
      const buildInput = await this.repository.getPublicBuildInput(site.currentPublicBuildInputId);
      if (!buildInput) continue;
      const snapshots = await Promise.all(buildInput.sourceSnapshotIds.map((idValue) => this.repository.getSourceSnapshot(idValue)));
      if (!snapshots.some((snapshot) => snapshot?.sourceUrl && normalizedSourceUrl(snapshot.sourceUrl) === source)) continue;
      const session = await this.getOrCreateSession({ siteId: site.id, ownerId: input.ownerId, buildInput });
      const run = (await this.repository.listAgentRuns(session.id)).find((candidate) => candidate.kind === "initial_build")
        ?? await this.enqueueRun({
          session,
          kind: "initial_build",
          instruction: "Create the complete initial customer website from the canonical public business input.",
          requestedBy: input.ownerId
        });
      return { site, session, run, buildInput };
    }
    return undefined;
  }

  private async persistWorkspaceSourceSidecar(
    revision: SiteWorkspaceRevisionV1,
    files: WorkspaceSourceFile[],
    backup: { id: string; revision: string; size: number; key: string; contentHash: `sha256:${string}` }
  ) {
    const sidecar = workspaceSourceSidecarV1Schema.parse({
      schemaVersion: "workspace-source-sidecar-v1",
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
    this.assertWorkspaceSidecarMatchesRevision(workspaceSourceSidecarV1Schema.parse(JSON.parse(retained.bytes.toString("utf8"))), revision);
  }

  private async loadWorkspaceSource(revisionId: string | undefined): Promise<WorkspaceSourceFile[]> {
    if (!revisionId) throw new Error("Site does not have a retained workspace revision.");
    const revision = await this.repository.getWorkspaceRevision(revisionId);
    if (!revision) throw new Error("Retained workspace revision is unavailable.");
    const sidecar = await this.loadWorkspaceSidecar(revision);
    return sidecar.files.map(({ path, content }) => workspaceSourceFileSchema.parse({ path, content }));
  }

  private async loadWorkspaceSidecar(revision: SiteWorkspaceRevisionV1): Promise<WorkspaceSourceSidecarV1> {
    const key = workspaceSourceSidecarKey(revision.sourceArchiveKey);
    const blob = await this.blobStore.get(key);
    if (!blob) throw new Error(`Retained workspace source sidecar is missing at ${key}.`);
    const sidecar = workspaceSourceSidecarV1Schema.parse(JSON.parse(blob.bytes.toString("utf8")));
    this.assertWorkspaceSidecarMatchesRevision(sidecar, revision);
    return sidecar;
  }

  private assertWorkspaceSidecarMatchesRevision(sidecar: WorkspaceSourceSidecarV1, revision: SiteWorkspaceRevisionV1) {
    if (sidecar.archiveKey !== revision.sourceArchiveKey || sidecar.sourceHash !== revision.sourceHash) {
      throw new Error(`Workspace sidecar does not match retained revision ${revision.id}.`);
    }
    const sidecarFiles = sidecar.files.map(({ path, contentHash, bytes }) => ({ path, contentHash, bytes }));
    if (stableJson(sidecarFiles) !== stableJson(revision.files)) {
      throw new Error(`Workspace sidecar file manifest does not match retained revision ${revision.id}.`);
    }
  }

  private async destroySessionSandbox(session: SiteAgentSessionV1, input: {
    reason: string;
    currentWorkspaceRevisionId?: string;
    now?: string;
  }) {
    const now = input.now ?? new Date().toISOString();
    if (!session.sandboxId) {
      const checkpointed = siteAgentSessionV1Schema.parse({
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
      const rotating = siteAgentSessionV1Schema.parse({
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
          schemaVersion: "operator-queue-item-v2",
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
    const checkpointed = siteAgentSessionV1Schema.parse({
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

  private async ensureSandbox(session: SiteAgentSessionV1, buildInput: SitePublicBuildInputV3) {
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
      current = siteAgentSessionV1Schema.parse({
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
      if (diagnostics?.ok && diagnostics.revision !== "uninitialized") return { session: current, revision: diagnostics.revision };
    }
    const startedAt = new Date().toISOString();
    const starting = siteAgentSessionV1Schema.parse({
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
      throw error;
    }
    const active = siteAgentSessionV1Schema.parse({
      ...starting,
      status: "active",
      leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(),
      rotateAt: new Date(Date.now() + rotationMs).toISOString(),
      updatedAt: new Date().toISOString()
    });
    await this.repository.saveAgentSession(active);
    return { session: active, revision };
  }

  private async checkpointAfterRunFailure(run: SiteAgentRunV2) {
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

  private async queueTerminalRunFailure(run: SiteAgentRunV2, error: unknown) {
    const existing = (await this.repository.listOperatorQueue()).some((item) => item.runId === run.id && item.status !== "resolved" && item.status !== "dismissed");
    if (existing) return;
    const now = new Date().toISOString();
    await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
      schemaVersion: "operator-queue-item-v2",
      id: id("operator"),
      siteId: run.siteId,
      runId: run.id,
      reason: "objective_failure",
      severity: "high",
      status: "open",
      findings: [{ stage: run.stage, message: failureMessage(error) }],
      createdAt: now,
      updatedAt: now
    }));
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
      builderVersion: "trusted-runtime-builder-v1",
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
      schemaVersion: "trusted-runtime-series-v1" as const,
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

  private async updateRun(run: SiteAgentRunV2, patch: Partial<SiteAgentRunV2>) {
    const updated = siteAgentRunV2Schema.parse({ ...run, ...patch, heartbeatAt: new Date().toISOString() });
    await this.repository.saveAgentRun(updated);
    return updated;
  }

  private async recoverInterruptedRun(run: SiteAgentRunV2) {
    const current = await this.requireRun(run.id);
    if (current.status !== "running" || current.attempt !== run.attempt) return current;
    run = current;
    await this.checkpointAfterRunFailure(run).catch(() => undefined);
    const retained = (await this.repository.listSiteVersions(run.siteId))
      .find((version) => version.createdBy.kind === "agent" && version.createdBy.id === run.id);
    const latest = await this.requireRun(run.id);
    if (latest.status !== "running" || latest.attempt !== run.attempt) return latest;
    if (retained) {
      return this.updateRun(latest, {
        status: "succeeded",
        stage: "candidate_ready",
        outputRevisionId: retained.workspaceRevisionId,
        candidateVersionId: retained.id,
        fastPreviewPath: undefined,
        failureReason: undefined,
        completedAt: new Date().toISOString()
      });
    }
    if (latest.attempt < 2) {
      return this.updateRun(latest, {
        status: "queued",
        stage: "queued",
        fastPreviewPath: undefined,
        failureReason: "interrupted_run_restarting_from_last_verified_checkpoint",
        completedAt: undefined
      });
    }
    return this.updateRun(latest, {
      status: "failed",
      stage: "failed",
      fastPreviewPath: undefined,
      failureReason: "interrupted_run_recovered_from_checkpoint",
      completedAt: new Date().toISOString()
    });
  }
}

export const agenticSiteWorkflow = new AgenticSiteWorkflowV1();

export const siteAgentRecoveryStaleAfterMs = 45 * 60_000;

export class EditClarificationRequiredError extends Error {
  readonly code = "clarification_required";
  constructor(readonly question: string) { super(question); }
}

export class EditPreflightFailedError extends Error {
  readonly code = "objective_preflight_failed";
}

export function configuredSandboxImageDigest() {
  return sandboxImageDigest;
}

export function managerRuntimeBudget(kind: ManagerRunRequestV3["kind"]) {
  const cycles = kind === "initial_build" ? 4 : 3;
  return { builds: cycles, inspections: cycles } as const;
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

function failureCode(error: unknown) {
  const value = failureMessage(error).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return (value || "unknown_failure").slice(0, 160);
}

function findingFingerprint(finding: { id: string; area: string; route?: string; message: string }) {
  return sha256(stableJson({
    id: finding.id,
    area: finding.area,
    route: finding.route ?? "/",
    message: finding.message.toLowerCase().replace(/\s+/g, " ").trim()
  }));
}

function exactRoutesIn(instruction: string) {
  return [...new Set([...instruction.matchAll(/(?:^|\s)(\/[a-z0-9][a-z0-9\-\/]*)\b/gi)].map((match) => match[1].replace(/\/$/, "") || "/"))];
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

function isRepairableWorkspaceFailure(error: unknown, stage?: SiteAgentRunV2["stage"]) {
  if (error && typeof error === "object" && (error as { name?: unknown }).name === "ZodError") return true;
  if (!(error instanceof Error)) return false;
  if (/^manager_(?:response|tool)_limit_exhausted$/.test(error.message)) {
    return stage === "building" || stage === "fast_preview" || stage === "verifying";
  }
  const status = (error as Error & { status?: number }).status;
  if (status === 400 || status === 422) return /artifact|build|compile|invalid|schema|tsx|css/i.test(error.message);
  return false;
}

function repairFailureStage(stage: SiteAgentRunV2["stage"]): "authoring" | "building" | "fast_preview" | "verifying" {
  return stage === "building" || stage === "fast_preview" || stage === "verifying" ? stage : "authoring";
}

function normalizedSourceUrl(value: string) {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.protocol}//${url.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
}
