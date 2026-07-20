import { randomBytes, randomUUID } from "node:crypto";
import { createPublicBuildInput, assertNoPrivateBuildInputFields, ingestWebsite, sha256, stableJson, UnsupportedWebsiteVerticalError } from "@/packages/business-data";
import { sitePlatformRepository, type SitePlatformRepository } from "@/packages/platform-data";
import { configuredArtifactBlobStore, persistFinalArtifact, type ArtifactBlobStore } from "@/packages/site-artifacts";
import { WebsiteManagerAgent, taskSkillFor, websiteManagerPromptVersion, workspaceSourceFileSchema, type ManagerRunRequestV2, type WorkspaceSourceFile } from "@/packages/site-agent";
import { configuredSiteSandboxClient, type SiteSandboxClient } from "@/packages/site-sandbox";
import { unsupportedCapabilityDemands, unsupportedCapabilityMessage } from "@/packages/site-capabilities";
import { platformOperationsRepository, redirectsStrandedByRoutes } from "@/packages/platform-operations";
import {
  agenticSitePlatformVersion,
  operatorQueueItemSchema,
  siteAgentRunV1Schema,
  siteAgentSessionV1Schema,
  siteVersionV4Schema,
  siteWorkspaceRevisionV1Schema,
  verticalDemandEventV1Schema,
  type SiteAgentRunV1,
  type SiteAgentSessionV1,
  type SiteBuildArtifactV1,
  type SiteElementSelectionV1,
  type SitePublicBuildInputV1,
  type SiteVersionV4
} from "@/packages/site-contracts";
import { sandboxImageDigest, siteToolchainVersion } from "@/packages/site-contracts/platform-versions";
import {
  finalizePreparedArtifact,
  createArtifactContactSheet,
  prepareSiteArtifact,
  runArtifactBrowserGate
} from "@/packages/site-verification";
import { createSiteRuntimePatch } from "@/packages/trusted-runtime";
import { verticalContextFor } from "@/packages/vertical-context";
import { WorkspaceManagerRuntimeV2, type RuntimeInspectionV2 } from "./manager-runtime";

const runtimeSeriesId = "site-runtime-v1";
export { agenticSitePlatformVersion, siteToolchainVersion };
const idleLeaseMs = 10 * 60_000;
const rotationMs = 2 * 60 * 60_000;

export class AgenticSiteWorkflowV1 {
  constructor(
    private readonly repository: SitePlatformRepository = sitePlatformRepository,
    private readonly blobStore: ArtifactBlobStore = lazyExternalClient(configuredArtifactBlobStore),
    private readonly sandbox: SiteSandboxClient = lazyExternalClient(configuredSiteSandboxClient),
    private readonly manager = new WebsiteManagerAgent()
  ) {}

  async bootstrapFromUrl(input: {
    url: string;
    ownerId: string;
    mode?: "draft" | "experimental";
    workspaceId?: string;
    slug?: string;
    signal?: AbortSignal;
  }) {
    const existing = await this.findExistingBootstrap(input);
    if (existing) return existing;
    const ingested = await ingestWebsite({
      url: input.url,
      slug: input.slug,
      workspaceId: input.workspaceId,
      signal: input.signal
    }).catch(async (error: unknown) => {
      if (error instanceof UnsupportedWebsiteVerticalError) {
        await this.repository.saveVerticalDemandEvent(verticalDemandEventV1Schema.parse({
          schemaVersion: "vertical-demand-event-v1",
          id: id("vertical_demand"),
          sourceUrl: input.url,
          observedVertical: error.observedVertical,
          requestedBy: input.ownerId,
          status: "open",
          createdAt: new Date().toISOString()
        }));
      }
      throw error;
    });
    const buildInput = createPublicBuildInput({
      id: id("input"),
      state: ingested.state,
      intent: ingested.intent,
      forms: ingested.forms,
      verticalModule: verticalContextFor(ingested.state.vertical.id),
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
      requestedBy: input.ownerId
    });
    return { site, session, run, buildInput };
  }

  async getOrCreateSession(input: { siteId: string; ownerId: string; buildInput?: SitePublicBuildInputV1 }) {
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
      sandboxId: sandboxId(),
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
    kind: SiteAgentRunV1["kind"];
    instruction: string;
    requestedBy: string;
    selection?: SiteElementSelectionV1;
    origin?: SiteAgentRunV1["origin"];
    deferBehindActive?: boolean;
    publishAfterSuccess?: boolean;
  }) {
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
          vertical: buildInput.verticalModule.version,
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
    const run = siteAgentRunV1Schema.parse({
      schemaVersion: "site-agent-run-v1",
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
        vertical: buildInput.verticalModule.version,
        [taskSkill.id]: taskSkill.version
      },
      toolCalls: [],
      attempts: [],
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 },
      startedAt: now
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
    let run: SiteAgentRunV1 = claimed;
    try {
      const session = await this.requireSession(run.sessionId);
      const buildInput = await this.requireBuildInput(run.publicBuildInputId);
      const site = await this.repository.getSite(run.siteId);
      if (!site) throw new Error("Site not found.");
      if ((site.currentWorkspaceRevisionId ?? undefined) !== (run.exactParentRevisionId ?? undefined)) throw new Error("stale_parent_revision");
      const sandboxState = await this.ensureSandbox(session, buildInput);
      if (run.kind === "rebase") {
        return await this.executeDeterministicRebase({ run, session: sandboxState.session, buildInput, sandboxRevision: sandboxState.revision });
      }
      const currentFiles = run.kind === "initial_build"
        ? undefined
        : (await this.sandbox.getSource(sandboxState.session.sandboxId!)).files.map((file) => workspaceSourceFileSchema.parse(file));
      const expectedRoutes = run.kind === "initial_build" ? undefined : await this.currentWorkspaceRoutes(run.siteId, site.currentWorkspaceRevisionId);
      const requestMessages = (await this.repository.listAgentMessages(session.id)).filter((message) => message.runId === run.id && (message.role === "owner" || message.role === "operator"));
      const ownerMessage = requestMessages.map((message) => message.content).join("\n\n")
        || "Apply the requested site change.";
      let repairUsed = false;
      let outcome;
      const firstStartedAt = new Date().toISOString();
      try {
        outcome = await this.runAttempt({
          run,
          session: sandboxState.session,
          buildInput,
          sandboxRevision: sandboxState.revision,
          currentFiles,
          instruction: ownerMessage,
          selection: selection ?? requestMessages.find((message) => message.selection)?.selection,
          kind: run.kind,
          expectedRoutes
        });
        run = outcome.run;
      } catch (error) {
        const latest = await this.requireRun(run.id);
        if (!isRepairableWorkspaceFailure(error, latest.stage)) throw error;
        run = latest;
        repairUsed = true;
        const failedAttempt = await this.captureFailedAttempt({
          runId: run.id,
          session: sandboxState.session,
          kind: run.kind,
          startedAt: firstStartedAt,
          error
        });
        run = failedAttempt.run;
        const repairStartedAt = new Date().toISOString();
        try {
          outcome = await this.runAttempt({
            run,
            session: sandboxState.session,
            buildInput,
            sandboxRevision: failedAttempt.sandboxRevision,
            currentFiles: failedAttempt.files,
            instruction: "Repair the workspace validation or build failure without changing supported facts, route intent, or unrelated design decisions.",
            objectiveFindings: [failedAttempt.diagnostic],
            kind: "qa_repair",
            expectedRoutes
          });
          run = outcome.run;
        } catch (repairError) {
          const latest = await this.requireRun(run.id);
          run = latest;
          if (isRepairableWorkspaceFailure(repairError, latest.stage)) {
            await this.captureFailedAttempt({
              runId: run.id,
              session: sandboxState.session,
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
          expectedRoutes: outcome.artifact.routes.map((route) => route.path)
        });
        run = outcome.run;
      } else if (!repairUsed && outcome.criticAvailable && outcome.subjectiveReview.verdict === "revise") {
        repairUsed = true;
        outcome = await this.runAttempt({
          run,
          session: outcome.session,
          buildInput,
          sandboxRevision: outcome.sandboxRevision,
          currentFiles: outcome.files,
          instruction: "Resolve the read-only visual critic's concrete findings without changing verified facts, supported capabilities, or unrelated design decisions.",
          objectiveFindings: outcome.subjectiveReview.findings.map((finding) => `${finding.route}: ${finding.message}`),
          kind: "qa_repair",
          expectedRoutes: outcome.artifact.routes.map((route) => route.path)
        });
        run = outcome.run;
      }
      if (outcome.artifact.qa.hardGate === "failed") {
        await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
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
          id: id("operator"), siteId: run.siteId, runId: run.id, versionId: version.id,
          reason: "subjective_finding", severity: outcome.criticAvailable ? "normal" : "high", status: "open",
          findings: [{ message: outcome.subjectiveReview.summary, repairUsed }, ...outcome.subjectiveReview.findings],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }));
      }
      run = await this.updateRun(run, {
        status: "succeeded",
        stage: "candidate_ready",
        outputRevisionId: outcome.revision.id,
        candidateVersionId: version.id,
        completedAt: new Date().toISOString()
      });
      await this.repository.appendAgentMessage({
        id: id("message"), sessionId: run.sessionId, runId: run.id, role: "agent",
        content: outcome.ownerMessage, createdAt: new Date().toISOString()
      });
      return run;
    } catch (error) {
      const latest = await this.repository.getAgentRun(run.id) ?? run;
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
    const sandboxState = await this.ensureSandbox(session, buildInput);
    const source = session.currentWorkspaceRevisionId ? await this.sandbox.getSource(sandboxState.session.sandboxId!) : undefined;
    await this.repository.appendAgentMessage({
      id: id("message"), sessionId: session.id, role: "owner", content: input.message,
      selection: input.selection, createdAt: new Date().toISOString()
    });
    const result = await this.manager.discuss({
      buildInput,
      message: input.message,
      currentFiles: source?.files.map((file) => workspaceSourceFileSchema.parse(file)),
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
    const staleBefore = new Date(Date.now() - (input.staleAfterMs ?? 15 * 60_000)).toISOString();
    const stale = await this.repository.listStaleRunningAgentRuns(staleBefore, limit);
    for (const run of stale) await this.recoverInterruptedRun(run);
    const queued = await this.repository.listQueuedAgentRuns(limit);
    const processed: SiteAgentRunV1[] = [];
    for (const run of queued) processed.push(await this.executeRunAndFinalize(run.id));
    return { reaped, recovered: stale.map((run) => run.id), processed };
  }

  async reapExpiredSessions(input: { limit?: number; now?: string } = {}) {
    const now = input.now ?? new Date().toISOString();
    const sessions = await this.repository.listExpiredAgentSessions(now, Math.max(1, Math.min(input.limit ?? 20, 100)));
    const reaped: string[] = [];
    for (const session of sessions) {
      const activeRun = (await this.repository.listAgentRuns(session.id)).some((run) => run.status === "queued" || run.status === "running");
      if (activeRun) continue;
      if (session.sandboxId) await this.sandbox.destroy(session.sandboxId).catch(() => undefined);
      const site = await this.repository.getSite(session.siteId);
      await this.repository.saveAgentSession(siteAgentSessionV1Schema.parse({
        ...session,
        status: "checkpointed",
        sandboxId: undefined,
        currentWorkspaceRevisionId: site?.currentWorkspaceRevisionId,
        leaseExpiresAt: now,
        updatedAt: now
      }));
      reaped.push(session.id);
    }
    return reaped;
  }

  async recoverRunIfStale(runId: string, staleAfterMs = 15 * 60_000) {
    const run = await this.requireRun(runId);
    if (run.status !== "running") return run;
    const heartbeat = Date.parse(run.heartbeatAt ?? run.startedAt);
    if (heartbeat > Date.now() - staleAfterMs) return run;
    return this.recoverInterruptedRun(run);
  }

  async promoteVersion(versionId: string, actorId: string) {
    const version = await this.repository.getSiteVersion(versionId);
    if (!version) throw new Error("Site version not found.");
    const site = await this.repository.getSite(version.siteId);
    if (site?.status === "experimental") throw new Error("experimental_site_not_publishable");
    const [artifact, redirects] = await Promise.all([
      this.repository.getBuildArtifact(version.artifactId),
      platformOperationsRepository.listRedirects(version.siteId)
    ]);
    if (!artifact) throw new Error("Site version artifact not found.");
    const stranded = redirectsStrandedByRoutes(redirects, artifact.routes.map((route) => route.path));
    if (stranded.length) throw new Error(`active_redirect_destination_missing:${stranded.map((redirect) => redirect.sourcePath).join(",")}`);
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
    await this.sandbox.restore(sandbox.session.sandboxId!, backupId, sandbox.revision);
    return this.enqueueRun({
      session: sandbox.session,
      kind: "rebase",
      instruction: `Restore retained version ${version.number} and recompile it against the current verified business snapshot.`,
      requestedBy: actorId
    });
  }

  private async runAttempt(input: {
    run: SiteAgentRunV1;
    session: SiteAgentSessionV1;
    buildInput: SitePublicBuildInputV1;
    sandboxRevision: string;
    currentFiles?: WorkspaceSourceFile[];
    instruction: string;
    selection?: SiteElementSelectionV1;
    objectiveFindings?: string[];
    kind: ManagerRunRequestV2["kind"];
    expectedRoutes?: string[];
  }) {
    let run = await this.updateRun(input.run, { stage: "authoring" });
    const modelStarted = new Date().toISOString();
    const fastPreviewPath = `/api/site-agent/sessions/${input.session.id}/preview`;
    const baseUsage = { ...run.usage };
    type Checkpoint = Awaited<ReturnType<AgenticSiteWorkflowV1["verifySandboxArtifact"]>> & {
      revision: ReturnType<typeof siteWorkspaceRevisionV1Schema.parse>;
    };
    const runtimeBudget = managerRuntimeBudget(input.kind);
    const runtime = new WorkspaceManagerRuntimeV2<Checkpoint>({
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
        const applied = await this.sandbox.apply(input.session.sandboxId!, expectedRevision, files);
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
      inspect: async (files, sandboxRevision): Promise<RuntimeInspectionV2<Checkpoint>> => {
        run = await this.updateRun(run, { stage: "verifying" });
        const [backup, site] = await Promise.all([
          this.sandbox.backup(input.session.sandboxId!),
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
        const finalized = await this.verifySandboxArtifact({
          run,
          session: input.session,
          buildInput: input.buildInput,
          workspaceRevisionId: revision.id,
          expectedRoutes: input.expectedRoutes,
          taskInstruction: input.instruction,
          taskKind: input.kind,
          runSubjectiveCritic: false
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
          modelSummary: {
            ok: finalized.artifact.qa.hardGate === "passed",
            workspaceHash: revision.sourceHash,
            sandboxRevision,
            publicBuildInputId: input.buildInput.id,
            toolchainVersion: siteToolchainVersion,
            sandboxImageDigest: configuredSandboxImageDigest(),
            inspectionHash,
            routes: finalized.artifact.routes,
            findings: errors.slice(0, 100)
          },
          traceSummary: {
            ok: finalized.artifact.qa.hardGate === "passed",
            workspaceHash: revision.sourceHash,
            sandboxRevision,
            inspectionHash,
            artifactHash: finalized.artifact.artifactHash,
            findingCount: finalized.artifact.qa.findings.length,
            errorCount: errors.length,
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
      runtime,
      onProgress: async ({ trace, usage, modelId }) => {
        run = await this.updateRun(run, {
          modelId,
          usage: {
            inputTokens: baseUsage.inputTokens + usage.inputTokens,
            outputTokens: baseUsage.outputTokens + usage.outputTokens,
            estimatedCostUsd: baseUsage.estimatedCostUsd + usage.estimatedCostUsd,
            costEstimateStatus: baseUsage.costEstimateStatus === "configured" && usage.costEstimateStatus === "configured" ? "configured" : usage.costEstimateStatus,
            durationMs: baseUsage.durationMs + usage.durationMs
          },
          toolCalls: [...run.toolCalls, {
            id: id("tool"),
            callId: trace.callId,
            name: `manager.${trace.name}`,
            inputHash: trace.inputHash,
            outputHash: trace.outputHash,
            startedAt: trace.startedAt,
            completedAt: trace.completedAt,
            status: trace.status
          }]
        });
      }
    });
    const checkpoint = runtime.finalCheckpoint();
    const { revision } = checkpoint;
    const critic = await this.manager.critiqueCandidate({
      buildInput: input.buildInput,
      visualThesis: managerResult.completion.visualThesis,
      contentArchitecture: managerResult.completion.contentArchitecture,
      taskInstruction: input.instruction,
      taskKind: input.kind,
      routes: checkpoint.artifact.routes.map(({ path, title, description }) => ({ path, title, description })),
      contactSheet: checkpoint.contactSheet,
      homepageDesktop: checkpoint.browserCaptures.find((capture) => capture.route === "/" && capture.viewport === "desktop")?.bytes,
      homepageMobile: checkpoint.browserCaptures.find((capture) => capture.route === "/" && capture.viewport === "mobile")?.bytes
    }).then((value) => ({ ...value, available: true as const }), (error) => ({
      critique: {
        schemaVersion: "manager-candidate-critique-v1" as const,
        verdict: "revise" as const,
        summary: "Automated visual review was unavailable; an operator must inspect the candidate before publishing.",
        findings: [{ route: "/", area: "craft" as const, severity: "high" as const, message: failureMessage(error).slice(0, 600) }]
      },
      modelId: "unavailable",
      promptVersion: "manager-visual-critic-v1",
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable" as const, durationMs: 0 },
      available: false as const
    }));
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
    let session = input.session;
    if (finalized.artifact.qa.hardGate === "passed") {
      await persistFinalArtifact({ artifact: finalized.artifact, files: finalized.files, store: this.blobStore });
      await this.repository.commitVerifiedBuild({ revision, artifact: finalized.artifact });
      session = siteAgentSessionV1Schema.parse({
        ...input.session,
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
    kind: ManagerRunRequestV2["kind"];
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

  private async executeDeterministicRebase(input: {
    run: SiteAgentRunV1;
    session: SiteAgentSessionV1;
    buildInput: SitePublicBuildInputV1;
    sandboxRevision: string;
  }) {
    let run = await this.updateRun(input.run, { stage: "building" });
    try {
      const startedAt = new Date().toISOString();
      const rebased = await this.sandbox.rebase(input.session.sandboxId!, input.sandboxRevision, input.buildInput);
      run = await this.updateRun(run, {
        stage: "fast_preview",
        fastPreviewPath: `/api/site-agent/sessions/${input.session.id}/preview`,
        toolCalls: [...run.toolCalls, toolCall("sandbox.rebase_public_input", { expectedRevision: input.sandboxRevision, inputHash: input.buildInput.inputHash }, rebased, startedAt)]
      });
      const [source, backup, site] = await Promise.all([
        this.sandbox.getSource(input.session.sandboxId!), this.sandbox.backup(input.session.sandboxId!), this.repository.getSite(run.siteId)
      ]);
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
      run = await this.updateRun(run, { stage: "verifying" });
      const finalized = await this.verifySandboxArtifact({
        run, session: input.session, buildInput: input.buildInput, workspaceRevisionId: revision.id, runSubjectiveCritic: false
      });
      run = await this.updateRun(run, { subjectiveReview: finalized.subjectiveReview });
      if (finalized.artifact.qa.hardGate === "failed") {
        await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
          id: id("operator"), siteId: run.siteId, runId: run.id, reason: "objective_failure", severity: "high", status: "open",
          findings: finalized.artifact.qa.findings, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }));
        throw new Error("Deterministic recompile failed the objective gate.");
      }
      await persistFinalArtifact({ artifact: finalized.artifact, files: finalized.files, store: this.blobStore });
      await this.repository.commitVerifiedBuild({ revision, artifact: finalized.artifact });
      const session = siteAgentSessionV1Schema.parse({
        ...input.session, status: "active", currentWorkspaceRevisionId: revision.id,
        leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(), updatedAt: new Date().toISOString()
      });
      await this.repository.saveAgentSession(session);
      const version = await this.createCandidateVersion(finalized.artifact, revision.id, input.buildInput, run);
      run = await this.updateRun(run, {
        status: "succeeded", stage: "candidate_ready", outputRevisionId: revision.id,
        candidateVersionId: version.id, completedAt: new Date().toISOString()
      });
      await this.repository.appendAgentMessage({
        id: id("message"), sessionId: run.sessionId, runId: run.id, role: "agent",
        content: "Recompiled the existing design against the updated verified business data. No model redesign was used.",
        createdAt: new Date().toISOString()
      });
      return run;
    } catch (error) {
      await this.checkpointAfterRunFailure(run).catch(() => undefined);
      return this.updateRun(run, {
        status: "failed", stage: "failed", fastPreviewPath: undefined, failureReason: failureMessage(error),
        completedAt: new Date().toISOString()
      });
    }
  }

  private async verifySandboxArtifact(input: {
    run: SiteAgentRunV1;
    session: SiteAgentSessionV1;
    buildInput: SitePublicBuildInputV1;
    workspaceRevisionId: string;
    runSubjectiveCritic?: boolean;
    expectedRoutes?: string[];
    taskInstruction?: string;
    taskKind?: ManagerRunRequestV2["kind"];
  }) {
    const authored = await this.sandbox.getArtifact(input.session.sandboxId!);
    const prepared = prepareSiteArtifact({ authoredArtifact: authored, buildInput: input.buildInput, runtimeSeriesId });
    for (const route of input.expectedRoutes ?? []) {
      if (!prepared.routes.some((candidate) => candidate.path === route)) {
        prepared.findings.push({ id: "route.regression", severity: "error", area: "route", route, message: `Existing route ${route} was removed by the edit.` });
      }
    }
    const runtime = await this.ensureRuntime();
    const artifactId = id("artifact");
    const capturePrefix = `site-captures/${input.run.siteId}/${artifactId}`;
    const browserGate = await runArtifactBrowserGate({ prepared, buildInput: input.buildInput, blobStore: this.blobStore, capturePrefix });
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
          homepageMobile: browserGate.captures.find((capture) => capture.route === "/" && capture.viewport === "mobile")?.bytes
        }).then((result) => ({ ...result, available: true as const }), (error) => ({
          critique: {
            schemaVersion: "manager-candidate-critique-v1" as const,
            verdict: "revise" as const,
            summary: "Automated visual review was unavailable; an operator must inspect the candidate before publishing.",
            findings: [{ route: "/", area: "craft" as const, severity: "high" as const, message: error instanceof Error ? error.message.slice(0, 600) : "Visual review failed." }]
          },
          modelId: "unavailable",
          promptVersion: "manager-visual-critic-v1",
          usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable" as const, durationMs: 0 },
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
          usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable" as const, durationMs: 0 },
          available: false as const
        }
        : {
          critique: { schemaVersion: "manager-candidate-critique-v1" as const, verdict: "revise" as const, summary: "Objective QA failed before visual review.", findings: [] },
          modelId: "not_run", promptVersion: "manager-visual-critic-v1",
          usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable" as const, durationMs: 0 },
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
      contactSheet,
      browserCaptures: browserGate.captures
    };
  }

  private async createCandidateVersion(
    artifact: SiteBuildArtifactV1,
    workspaceRevisionId: string,
    buildInput: SitePublicBuildInputV1,
    run: SiteAgentRunV1
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

  private async ensureSandbox(session: SiteAgentSessionV1, buildInput: SitePublicBuildInputV1) {
    let current = session;
    if (session.status === "closed" || session.status === "failed") throw new Error("Agent session is not reusable.");
    const leaseExpired = Date.parse(session.leaseExpiresAt) <= Date.now();
    if (leaseExpired && session.sandboxId) {
      await this.sandbox.destroy(session.sandboxId).catch(() => undefined);
      const site = await this.repository.getSite(session.siteId);
      current = siteAgentSessionV1Schema.parse({
        ...session,
        status: "checkpointed",
        sandboxId: undefined,
        currentWorkspaceRevisionId: site?.currentWorkspaceRevisionId,
        leaseExpiresAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      await this.repository.saveAgentSession(current);
    }
    const shouldRotate = Date.parse(current.rotateAt) <= Date.now();
    if (shouldRotate && current.sandboxId) {
      await this.sandbox.destroy(current.sandboxId).catch(() => undefined);
      current = siteAgentSessionV1Schema.parse({
        ...current,
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
    const next = current.sandboxId ? current : siteAgentSessionV1Schema.parse({ ...current, sandboxId: sandboxId() });
    const bootstrapped = await this.sandbox.bootstrap(next.sandboxId!, buildInput);
    let revision = bootstrapped.revision;
    if (next.currentWorkspaceRevisionId) {
      const workspace = await this.repository.getWorkspaceRevision(next.currentWorkspaceRevisionId);
      const backupId = workspace?.sourceArchiveKey.match(/^workspace-backups\/([a-f0-9]{64})\.tar\.gz$/)?.[1];
      if (!backupId) throw new Error("Retained workspace backup is unavailable for restore.");
      revision = (await this.sandbox.restore(next.sandboxId!, backupId, revision)).revision;
    }
    const active = siteAgentSessionV1Schema.parse({
      ...next,
      status: "active",
      leaseExpiresAt: new Date(Date.now() + idleLeaseMs).toISOString(),
      rotateAt: new Date(Date.now() + rotationMs).toISOString(),
      updatedAt: new Date().toISOString()
    });
    await this.repository.saveAgentSession(active);
    return { session: active, revision };
  }

  private async checkpointAfterRunFailure(run: SiteAgentRunV1) {
    const [session, site] = await Promise.all([
      this.repository.getAgentSession(run.sessionId),
      this.repository.getSite(run.siteId)
    ]);
    if (!session) return;
    if (session.sandboxId) await this.sandbox.destroy(session.sandboxId).catch(() => undefined);
    const now = new Date().toISOString();
    await this.repository.saveAgentSession(siteAgentSessionV1Schema.parse({
      ...session,
      status: "checkpointed",
      sandboxId: undefined,
      currentWorkspaceRevisionId: site?.currentWorkspaceRevisionId,
      leaseExpiresAt: now,
      updatedAt: now
    }));
  }

  private async queueTerminalRunFailure(run: SiteAgentRunV1, error: unknown) {
    const existing = (await this.repository.listOperatorQueue()).some((item) => item.runId === run.id && item.status !== "resolved" && item.status !== "dismissed");
    if (existing) return;
    const now = new Date().toISOString();
    await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
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

  private async updateRun(run: SiteAgentRunV1, patch: Partial<SiteAgentRunV1>) {
    const updated = siteAgentRunV1Schema.parse({ ...run, ...patch, heartbeatAt: new Date().toISOString() });
    await this.repository.saveAgentRun(updated);
    return updated;
  }

  private async recoverInterruptedRun(run: SiteAgentRunV1) {
    await this.checkpointAfterRunFailure(run).catch(() => undefined);
    const retained = (await this.repository.listSiteVersions(run.siteId))
      .find((version) => version.createdBy.kind === "agent" && version.createdBy.id === run.id);
    if (retained) {
      return this.updateRun(run, {
        status: "succeeded",
        stage: "candidate_ready",
        outputRevisionId: retained.workspaceRevisionId,
        candidateVersionId: retained.id,
        fastPreviewPath: undefined,
        failureReason: undefined,
        completedAt: new Date().toISOString()
      });
    }
    if (run.attempt < 2) {
      return this.updateRun(run, {
        status: "queued",
        stage: "queued",
        fastPreviewPath: undefined,
        failureReason: "interrupted_run_restarting_from_last_verified_checkpoint",
        completedAt: undefined
      });
    }
    return this.updateRun(run, {
      status: "failed",
      stage: "failed",
      fastPreviewPath: undefined,
      failureReason: "interrupted_run_recovered_from_checkpoint",
      completedAt: new Date().toISOString()
    });
  }
}

export const agenticSiteWorkflow = new AgenticSiteWorkflowV1();

function toolCall(name: string, input: unknown, output: unknown, startedAt: string): SiteAgentRunV1["toolCalls"][number] {
  return {
    id: id("tool"), name, inputHash: sha256(stableJson(input)), outputHash: sha256(stableJson(output)),
    startedAt, completedAt: new Date().toISOString(), status: "succeeded"
  };
}

export function configuredSandboxImageDigest() {
  return sandboxImageDigest;
}

export function managerRuntimeBudget(kind: ManagerRunRequestV2["kind"]) {
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

function id(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
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

function isRepairableWorkspaceFailure(error: unknown, stage?: SiteAgentRunV1["stage"]) {
  if (error && typeof error === "object" && (error as { name?: unknown }).name === "ZodError") return true;
  if (!(error instanceof Error)) return false;
  if (/^manager_(?:response|tool)_limit_exhausted$/.test(error.message)) {
    return stage === "building" || stage === "fast_preview" || stage === "verifying";
  }
  const status = (error as Error & { status?: number }).status;
  if (status === 400 || status === 422) return /artifact|build|compile|invalid|schema|tsx|css/i.test(error.message);
  return false;
}

function repairFailureStage(stage: SiteAgentRunV1["stage"]): "authoring" | "building" | "fast_preview" | "verifying" {
  return stage === "building" || stage === "fast_preview" || stage === "verifying" ? stage : "authoring";
}

function normalizedSourceUrl(value: string) {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.protocol}//${url.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
}
