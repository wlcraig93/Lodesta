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
import { ManagerNeedsInputError, WebsiteManagerAgent, taskSkillFor, websiteManagerPromptVersion, workspaceSourceFileSchema, workspaceSourcePolicyVersion, type ManagerRunRequest, type WorkspaceSourceFile } from "@/packages/site-agent";
import { configuredSiteSandboxClient, type SiteSandboxClient } from "@/packages/site-sandbox";
import {
  siteAuthoringPlatformVersion,
  operatorQueueItemSchema,
  siteAgentRunSchema,
  siteAgentSessionSchema,
  siteVersionV4Schema,
  siteWorkspaceRevisionV1Schema,
  verticalDemandEventSchema,
  type SiteAgentRun,
  type SiteAgentSession,
  type SiteBuildArtifactV1,
  type SiteElementSelectionV1,
  type SitePublicBuildInputV3,
  type SiteVersionV4,
  type SiteWorkspaceRevisionV1
} from "@/packages/site-contracts";
import { sandboxImageDigest, siteToolchainVersion, siteVerificationPolicyVersion } from "@/packages/site-contracts/platform-versions";
import {
  finalizePreparedArtifact,
  createArtifactContactSheet,
  prepareSiteArtifact,
  runArtifactBrowserGate
} from "@/packages/site-verification";
import { createSiteRuntimePatch } from "@/packages/trusted-runtime";
import { platformOperationsRepository, type PlatformOperationsRepository } from "@/packages/platform-operations";
import { WorkspaceManagerRuntime, type RuntimeInspection } from "./manager-runtime";
import { deriveSitePublicationReadiness } from "./publication-readiness";
import { SiteAgentEventRecorder } from "./run-events";
import { sendOwnerOperationalEmail } from "@/lib/owner-notifications";

const runtimeSeriesId = "site-runtime-v1";
export { siteAuthoringPlatformVersion, siteToolchainVersion };
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
      await this.repository.saveVerticalDemandEvent(verticalDemandEventSchema.parse({
        schemaVersion: "vertical-demand-event",
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
    const session = siteAgentSessionSchema.parse({
      schemaVersion: "site-agent-session",
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
    session: SiteAgentSession;
    kind: SiteAgentRun["kind"];
    instruction: string;
    requestedBy: string;
    selection?: SiteElementSelectionV1;
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
    const coalesced = input.origin === "control_plane"
      ? sessionRuns.find((candidate) => candidate.status === "queued" && candidate.origin === "control_plane")
      : undefined;
    if (coalesced) {
      const kind = coalesced.kind === "edit" || input.kind === "edit" ? "edit" as const : "rebase" as const;
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
        schemaVersion: "site-agent-message", id: id("message"), sessionId: input.session.id, runId: updated.id,
        role: input.requestedBy === input.session.ownerId ? "owner" : "operator",
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
      requestedBy: input.requestedBy,
      publishAfterSuccess: Boolean(input.publishAfterSuccess),
      kind: input.kind,
      status: "queued",
      stage: "queued",
      exactParentRevisionId: current.currentWorkspaceRevisionId,
      deferredUntilRunId: input.deferBehindActive ? activeRun?.id : undefined,
      modelId: process.env.LODESTA_SITE_AGENT_MODEL ?? "configured-at-run",
      executionNumber: 0,
      skillVersions: {
        manager: websiteManagerPromptVersion,
        domainContext: buildInput.domainContext?.version ?? "none",
        [taskSkill.id]: taskSkill.version
      },
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 },
      startedAt: input.workflowStartedAt ?? now
    });
    await this.repository.saveAgentRun(run);
    await this.repository.appendAgentMessage({
      schemaVersion: "site-agent-message",
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

  async enqueueEdit(input: {
    session: SiteAgentSession;
    instruction: string;
    requestedBy: string;
    selection?: SiteElementSelectionV1;
    signal?: AbortSignal;
  }) {
    const site = await this.repository.getSite(input.session.siteId);
    if (!site) throw new Error("Site not found.");
    if (input.selection?.workspaceRevisionId && input.selection.workspaceRevisionId !== site.currentWorkspaceRevisionId) throw new Error("stale_selection");
    const run = await this.enqueueRun({ session: input.session, kind: "edit", instruction: input.instruction, requestedBy: input.requestedBy, selection: input.selection });
    return { run };
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
      const currentFiles = run.kind === "initial_build"
        ? undefined
        : await this.loadWorkspaceSource(site.currentWorkspaceRevisionId);
      const requestMessages = (await this.repository.listAgentMessages(session.id)).filter((message) => message.runId === run.id && (message.role === "owner" || message.role === "operator"));
      const ownerMessage = requestMessages.map((message) => message.content).join("\n\n")
        || "Apply the requested site change.";
      const outcome = await this.runAuthoring({
        run,
        session,
        buildInput,
        sandboxRevision: "deferred",
        currentFiles,
        instruction: ownerMessage,
        selection: selection ?? requestMessages.find((message) => message.selection)?.selection,
        kind: run.kind,
        signal: workflowSignal
      });
      run = outcome.run;
      if (outcome.artifact.qa.hardGate === "failed") {
        await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
          schemaVersion: "operator-queue-item",
          id: id("operator"), siteId: run.siteId, runId: run.id,
          reason: "verification_failure", severity: "high", status: "open",
          findings: outcome.artifact.qa.findings,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }));
        throw new Error("Candidate failed the release hard gate.");
      }
      const version = await this.createCandidateVersion(outcome.artifact, outcome.revision.id, buildInput, run);
      run = await this.updateRun(run, {
        status: "succeeded",
        stage: "candidate_ready",
        fastPreviewPath: undefined,
        outputRevisionId: outcome.revision.id,
        candidateVersionId: version.id,
        completedAt: new Date().toISOString()
      });
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
            actionPath: `/workspace/${site.slug}/website`
          }).catch(() => undefined);
        }
        return waiting;
      }
      if (Date.now() >= deadlineAt) error = new Error("workflow_deadline_exhausted");
      const latest = await this.repository.getAgentRun(run.id) ?? run;
      await this.repository.failOpenAgentRunEvents(run.id, new Date().toISOString(), failureCode(error)).catch(() => undefined);
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
    if (session.ownerId !== input.actorId) throw new Error("Session owner mismatch.");
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
        instruction: `${original}\n\nOwner clarification: ${answer}`,
        requestedBy: input.actorId,
        origin: waiting.origin
      });
    }
    if ((await this.repository.listAgentRuns(currentSession.id)).some((run) => run.id !== waiting.id && (run.status === "queued" || run.status === "running"))) {
      throw new Error("session_has_active_run");
    }
    await this.repository.appendAgentMessage({
      schemaVersion: "site-agent-message", id: id("message"), sessionId: currentSession.id, runId: waiting.id, role: "owner",
      content: `Owner clarification: ${answer}`, createdAt: now
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
    selection?: SiteElementSelectionV1;
    signal?: AbortSignal;
  }) {
    const session = await this.requireSession(input.sessionId);
    if (session.ownerId !== input.ownerId) throw new Error("Session owner mismatch.");
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
    for (const run of await this.repository.listRecentAgentRuns({ status: "needs_input", limit: 100 })) {
      if (run.inputExpiresAt && run.inputExpiresAt <= now) await this.updateRun(run, { status: "cancelled", completedAt: now });
    }
    const queued = await this.repository.listQueuedAgentRuns(limit);
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
    let session = await this.getOrCreateSession({ siteId: site.id, ownerId: actorId, buildInput });
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
    buildInput: SitePublicBuildInputV3;
    sandboxRevision: string;
    currentFiles?: WorkspaceSourceFile[];
    instruction: string;
    selection?: SiteElementSelectionV1;
    kind: ManagerRunRequest["kind"];
    signal?: AbortSignal;
  }) {
    let run = await this.updateRun(input.run, { stage: "authoring" });
    const recorder = new SiteAgentEventRecorder(this.repository, this.blobStore, run.id);
    const runEvent = await recorder.open({
      kind: "run",
      name: input.kind,
      summary: { kind: input.kind, publicBuildInputId: input.buildInput.id }
    });
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
    type RevisionDraft = Omit<SiteWorkspaceRevisionV1, "sourceArchiveKey">;
    type Checkpoint = Awaited<ReturnType<SiteAuthoringWorkflow["verifySandboxArtifact"]>> & { revisionDraft: RevisionDraft };
    const runtime = new WorkspaceManagerRuntime<Checkpoint>({
      kind: input.kind,
      publicBuildInputId: input.buildInput.id,
      toolchainVersion: siteToolchainVersion,
      sandboxImageDigest: configuredSandboxImageDigest(),
      initialFiles: input.currentFiles,
      initialSandboxRevision: input.sandboxRevision,
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
      inspect: async (files, sandboxRevision): Promise<RuntimeInspection<Checkpoint>> => {
        run = await this.updateRun(run, { stage: "verifying" });
        const site = await this.repository.getSite(run.siteId);
        if (!site) throw new Error("Site not found.");
        const parent = site.currentWorkspaceRevisionId ? await this.repository.getWorkspaceRevision(site.currentWorkspaceRevisionId) : undefined;
        const workspaceRevisionId = id("workspace_revision");
        const sourceHash = sha256(stableJson(files));
        const finalized = await this.verifySandboxArtifact({
          run,
          session: activeSession,
          buildInput: input.buildInput,
          workspaceRevisionId,
          signal: input.signal
        });
        const errors = finalized.artifact.qa.findings.filter((finding) => finding.severity === "error");
        const warnings = finalized.artifact.qa.findings.filter((finding) => finding.severity === "warning");
        let checkpoint: Checkpoint | undefined;
        if (finalized.artifact.qa.hardGate === "passed") {
          const revisionDraft = {
            schemaVersion: "site-workspace-revision-v1",
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
        const inspectionHash = sha256(stableJson({
          workspaceHash: sourceHash,
          publicBuildInputHash: input.buildInput.inputHash,
          verificationPolicyVersion: siteVerificationPolicyVersion,
          sourcePolicyVersion: workspaceSourcePolicyVersion,
          toolchainVersion: siteToolchainVersion,
          sandboxImageDigest: configuredSandboxImageDigest(),
          runtimePatchId: finalized.artifact.runtimePatchAtFinalization,
          artifactHash: finalized.artifact.artifactHash,
          hardGate: finalized.artifact.qa.hardGate,
          findings: finalized.artifact.qa.findings,
          screenshotKeys: finalized.artifact.qa.screenshotKeys
        }));
        return {
          passed: finalized.artifact.qa.hardGate === "passed",
          inspectionHash,
          modelSummary: {
            ok: finalized.artifact.qa.hardGate === "passed",
            workspaceHash: sourceHash,
            sandboxRevision,
            publicBuildInputId: input.buildInput.id,
            toolchainVersion: siteToolchainVersion,
            sandboxImageDigest: configuredSandboxImageDigest(),
            inspectionHash,
            routes: finalized.artifact.routes,
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
      instruction: input.instruction,
      kind: input.kind,
      selection: input.selection,
      signal: input.signal,
      runtime,
      onEvents: async (events) => { await recorder.recordManagerEvents(events); },
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
    const backup = await this.sandbox.backup(activeSession.sandboxId!);
    const revision = siteWorkspaceRevisionV1Schema.parse({ ...checkpoint.revisionDraft, sourceArchiveKey: backup.backup.key });
    const finalized = checkpoint;
    await this.persistVerificationCaptures(finalized);
    await this.persistWorkspaceSourceSidecar(revision, runtime.currentFiles(), backup.backup);
    await persistFinalArtifact({ artifact: finalized.artifact, files: finalized.files, store: this.blobStore });
    await this.repository.commitVerifiedBuild({ revision, artifact: finalized.artifact });
    const session = siteAgentSessionSchema.parse({
      ...activeSession,
      status: "active",
      currentWorkspaceRevisionId: revision.id,
      leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(),
      updatedAt: new Date().toISOString()
    });
    await this.repository.saveAgentSession(session);
    run = await this.updateRun(run, {
      outputArtifactId: finalized.artifact.id,
      screenshotKeys: finalized.artifact.qa.screenshotKeys
    });
    await recorder.close(runEvent, {
      status: "succeeded",
      inputTokens: managerResult.usage.inputTokens,
      cachedInputTokens: managerResult.usage.cachedInputTokens,
      outputTokens: managerResult.usage.outputTokens,
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
      ownerMessage: managerResult.completion.ownerMessage
    };
  }

  private async executeDeterministicRebase(input: {
    run: SiteAgentRun;
    session: SiteAgentSession;
    buildInput: SitePublicBuildInputV3;
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
      const rebased = await this.sandbox.rebase(input.session.sandboxId!, input.sandboxRevision, input.buildInput);
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
        throw new Error("Deterministic recompile failed the release hard gate.");
      }
      const backup = await this.sandbox.backup(input.session.sandboxId!);
      const revision = siteWorkspaceRevisionV1Schema.parse({
        schemaVersion: "site-workspace-revision-v1", id: workspaceRevisionId, siteId: run.siteId,
        parentRevisionId: site.currentWorkspaceRevisionId, revisionNumber: (parent?.revisionNumber ?? 0) + 1,
        sourceHash, sourceArchiveKey: backup.backup.key,
        files: files.map((file) => ({ path: file.path, contentHash: sha256(file.content), bytes: Buffer.byteLength(file.content) })),
        createdAt: new Date().toISOString(), createdBy: { kind: "system", id: run.id }
      });
      await this.persistVerificationCaptures(finalized);
      await this.persistWorkspaceSourceSidecar(revision, files, backup.backup);
      await persistFinalArtifact({ artifact: finalized.artifact, files: finalized.files, store: this.blobStore });
      await this.repository.commitVerifiedBuild({ revision, artifact: finalized.artifact });
      assertWithinDeadline();
      const session = siteAgentSessionSchema.parse({
        ...input.session, status: "active", currentWorkspaceRevisionId: revision.id,
        leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(), updatedAt: new Date().toISOString()
      });
      await this.repository.saveAgentSession(session);
      const version = await this.createCandidateVersion(finalized.artifact, revision.id, input.buildInput, run);
      run = await this.updateRun(run, {
        status: "succeeded", stage: "candidate_ready", fastPreviewPath: undefined, outputRevisionId: revision.id,
        outputArtifactId: finalized.artifact.id, screenshotKeys: finalized.artifact.qa.screenshotKeys,
        candidateVersionId: version.id, completedAt: new Date().toISOString()
      });
      await recorder.close(runEvent, { status: "succeeded", summary: { workspaceRevisionId: revision.id, artifactId: finalized.artifact.id, candidateVersionId: version.id } });
      await this.repository.appendAgentMessage({
        schemaVersion: "site-agent-message", id: id("message"), sessionId: run.sessionId, runId: run.id, role: "agent",
        content: "Recompiled the existing design against the updated verified business data. No model redesign was used.",
        createdAt: new Date().toISOString()
      });
      await this.destroySessionSandbox(session, { reason: "terminal_rebase_success", currentWorkspaceRevisionId: revision.id });
      return run;
    } catch (error) {
      const failure = input.signal.aborted ? new Error("workflow_deadline_exhausted") : error;
      await this.repository.failOpenAgentRunEvents(run.id, new Date().toISOString(), failureCode(failure)).catch(() => undefined);
      await this.checkpointAfterRunFailure(run).catch(() => undefined);
      await this.queueTerminalRunFailure(run, failure).catch(() => undefined);
      return this.updateRun(run, {
        status: "failed", stage: "failed", fastPreviewPath: undefined, failureReason: failureMessage(failure),
        completedAt: new Date().toISOString()
      });
    }
  }

  private async verifySandboxArtifact(input: {
    run: SiteAgentRun;
    session: SiteAgentSession;
    buildInput: SitePublicBuildInputV3;
    workspaceRevisionId: string;
    signal?: AbortSignal;
  }) {
    const authored = await this.sandbox.getArtifact(input.session.sandboxId!);
    const prepared = prepareSiteArtifact({ authoredArtifact: authored, buildInput: input.buildInput, runtimeSeriesId });
    const runtime = await this.ensureRuntime();
    const artifactId = id("artifact");
    const capturePrefix = `site-captures/${input.run.siteId}/${artifactId}`;
    const browserGate = await runArtifactBrowserGate({ prepared, buildInput: input.buildInput, blobStore: this.blobStore, capturePrefix, signal: input.signal });
    const contactSheet = await createArtifactContactSheet(browserGate.captures);
    const contactSheetKey = `${capturePrefix}/contact-sheet.png`;
    const finalized = finalizePreparedArtifact({
      prepared, buildInput: input.buildInput, artifactId, workspaceRevisionId: input.workspaceRevisionId,
      runtimeSeriesId, runtimePatchId: runtime.patch.id, storagePrefix: `site-artifacts/${input.run.siteId}/${artifactId}`,
      toolchainVersion: siteToolchainVersion, sandboxImageDigest: configuredSandboxImageDigest(),
      browserGate: { findings: browserGate.findings, screenshotKeys: [...browserGate.captures.map((capture) => capture.key), contactSheetKey],
        routesChecked: browserGate.routesChecked, linksChecked: browserGate.linksChecked }
    });
    return {
      ...finalized,
      contactSheet,
      contactSheetKey,
      browserCaptures: browserGate.captures
    };
  }

  private async createCandidateVersion(
    artifact: SiteBuildArtifactV1,
    workspaceRevisionId: string,
    buildInput: SitePublicBuildInputV3,
    run: SiteAgentRun
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

  private async persistVerificationCaptures(input: {
    browserCaptures: Array<{ key: string; bytes: Buffer }>;
    contactSheet: Buffer;
    contactSheetKey: string;
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

  private async ensureSandbox(session: SiteAgentSession, buildInput: SitePublicBuildInputV3) {
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
      if (diagnostics?.ok && diagnostics.revision !== "uninitialized") return { session: current, revision: diagnostics.revision };
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
      throw error;
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

  private async queueTerminalRunFailure(run: SiteAgentRun, error: unknown) {
    const existing = (await this.repository.listOperatorQueue()).some((item) => item.runId === run.id && item.status !== "resolved" && item.status !== "dismissed");
    if (existing) return;
    const now = new Date().toISOString();
    await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
      schemaVersion: "operator-queue-item",
      id: id("operator"),
      siteId: run.siteId,
      runId: run.id,
      reason: "verification_failure",
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
        failureReason: undefined,
        completedAt: new Date().toISOString()
      });
    }
    if (latest.executionNumber < 2) {
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

export const siteAuthoringWorkflow = new SiteAuthoringWorkflow();

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

function failureCode(error: unknown) {
  const value = failureMessage(error).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return (value || "unknown_failure").slice(0, 160);
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

function normalizedSourceUrl(value: string) {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.protocol}//${url.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
}
