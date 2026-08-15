import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSitePlatformRepository } from "../packages/platform-data/repository";
import {
  businessStateSchema,
  expectedSiteSandboxManifest,
  formDefinitionSchema,
  siteAgentRunSchema,
  siteAgentSessionSchema,
  siteAgentWorkspaceCheckpointSchema,
  siteIntentSchema,
  sitePublicBuildInputSchema,
  siteSandboxControlSchema,
  siteSandboxDeploymentSchema,
  type SiteAgentRun,
  type SiteAgentSession
} from "../packages/site-contracts";
import { siteAgentRunGuardrailsForKind } from "../packages/site-agent";
import { activeExecutionLeaseExpiresAt } from "../packages/site-platform/workflow";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const directory = await mkdtemp(join(tmpdir(), "lodesta-blue-green-lifecycle-"));
const repository = new LocalSitePlatformRepository(join(directory, "repository.json"));
const ownerId = "58c3a17e-6ad5-4e2c-9eb3-90e71527a054";
const createdAt = "2026-07-31T12:00:00.000Z";

const executionGuardrails = siteAgentRunGuardrailsForKind("edit", createdAt);
assert.equal(
  activeExecutionLeaseExpiresAt({ guardrails: executionGuardrails }, Date.parse(createdAt)),
  new Date(Date.parse(executionGuardrails.deadlineAt) + 60_000).toISOString(),
  "An active run's sandbox lease did not cover its full execution deadline."
);

try {
  const firstInput = buildSyntheticSiteInput();
  await repository.createSite({
    id: firstInput.siteId,
    ownerUserId: ownerId,
    businessId: firstInput.businessId,
    slug: "blue-green-test",
    status: "active",
    reportingTimezone: "UTC",
    currentPublicBuildInputId: firstInput.id,
    createdAt,
    updatedAt: createdAt
  });
  await repository.saveBusinessState(businessStateSchema.parse({
    schemaVersion: 1,
    businessId: firstInput.businessId,
    siteId: firstInput.siteId,
    revision: 1,
    ownerOperationalRevision: firstInput.ownerOperationalRevision,
    stateHash: hash("d"),
    updatedAt: createdAt,
    identity: {
      name: firstInput.business.name,
      status: firstInput.business.identityStatus,
      description: firstInput.business.description,
      categories: []
    },
    contacts: firstInput.business.contacts,
    locations: firstInput.business.locations,
    serviceAreas: firstInput.business.serviceAreas,
    offerings: firstInput.business.offerings,
    proof: firstInput.business.proof,
    assets: firstInput.business.assets,
    links: firstInput.business.links,
    facts: firstInput.publicFacts
  }));
  await repository.saveSiteIntent(firstInput.intent);
  for (const form of firstInput.forms) await repository.saveFormDefinition(form);
  await repository.savePublicBuildInput(firstInput);
  let session = siteAgentSessionSchema.parse({
    schemaVersion: "site-agent-session",
    id: "session_blue_green_test",
    siteId: firstInput.siteId,
    principal: { kind: "owner", id: ownerId },
    status: "active",
    publicBuildInputId: firstInput.id,
    sandboxProvider: "cloudflare",
    leaseTokenHash: hash("1"),
    leaseExpiresAt: "2026-08-01T12:00:00.000Z",
    rotateAt: "2026-08-02T12:00:00.000Z",
    createdAt,
    updatedAt: createdAt
  });
  await repository.saveAgentSession(session);

  const firstQueued = await repository.enqueueAgentRun(buildRun("run_blue_green_stale", firstInput.id));
  const firstClaim = required(await repository.claimAgentRun(firstQueued.id));
  assert.equal(firstClaim.executionNumber, 1);
  assert(firstClaim.sandboxDeploymentId, "The canonical targeted claim did not pin the active deployment.");
  const blueDeploymentId = firstClaim.sandboxDeploymentId;
  session = await bindSandbox(session, firstClaim, "sandbox_blue_warm");

  const green = siteSandboxDeploymentSchema.parse({
    schemaVersion: 1,
    id: "sandbox_deployment_green_test",
    slot: "green",
    workerVersionId: "green-test-version",
    releaseSha: "2".repeat(40),
    imageDigest: hash("2"),
    credentialSlot: "green",
    manifest: expectedSiteSandboxManifest,
    createdAt
  });
  await repository.saveSandboxDeployment(green);
  const blueControl = required(await repository.getSandboxControl());
  await repository.saveSandboxControl(siteSandboxControlSchema.parse({
    ...blueControl,
    greenDeploymentId: green.id,
    updatedAt: "2026-07-31T12:01:00.000Z"
  }));
  await repository.saveSandboxControl(siteSandboxControlSchema.parse({
    ...blueControl,
    greenDeploymentId: green.id,
    activeDeploymentId: green.id,
    updatedAt: "2026-07-31T12:02:00.000Z"
  }));
  const pinnedAcrossPromotion = required(await repository.getAgentRun(firstClaim.id));
  assert.equal(pinnedAcrossPromotion.status, "running");
  assert.equal(
    pinnedAcrossPromotion.sandboxDeploymentId,
    blueDeploymentId,
    "Promotion moved an already-running execution off its immutable deployment pin."
  );
  assert.deepEqual(await repository.getSandboxDeploymentDrain(blueDeploymentId), {
    runningRunIds: [firstClaim.id],
    liveSessionIds: [session.id]
  }, "Promotion stopped protecting the draining slot used by a running execution.");

  const invalidCheckpoint = buildCheckpoint(firstClaim, session, "c", 2);
  await assert.rejects(() => repository.pauseAgentRunForInput({
    checkpoint: invalidCheckpoint,
    run: waitingRun(firstClaim, invalidCheckpoint.id),
    session: pausedSession(session)
  }), /checkpoint_execution_fenced/);
  assert.equal((await repository.getAgentRun(firstClaim.id))?.status, "running", "A failed checkpoint exposed a durable pause.");

  const staleCheckpoint = buildCheckpoint(firstClaim, session, "a");
  const firstPause = await repository.pauseAgentRunForInput({
    checkpoint: staleCheckpoint,
    run: waitingRun(firstClaim, staleCheckpoint.id),
    session: pausedSession(session)
  });
  assert.equal(firstPause.run.status, "needs_input");
  assert.equal((await repository.getAgentWorkspaceCheckpoint(staleCheckpoint.id))?.workspaceHash, staleCheckpoint.workspaceHash);
  assert.deepEqual(await repository.getSandboxDeploymentDrain(blueDeploymentId), {
    runningRunIds: [],
    liveSessionIds: [session.id]
  }, "A paused checkpoint incorrectly counted as a running drain reference.");

  const replacementBlue = siteSandboxDeploymentSchema.parse({
    schemaVersion: 1,
    id: "sandbox_deployment_blue_replacement_test",
    slot: "blue",
    workerVersionId: "blue-replacement-version",
    releaseSha: "3".repeat(40),
    imageDigest: hash("3"),
    credentialSlot: "blue",
    manifest: expectedSiteSandboxManifest,
    createdAt
  });
  await repository.saveSandboxDeployment(replacementBlue);
  const drainingControl = required(await repository.getSandboxControl());
  await assert.rejects(() => repository.saveSandboxControl(siteSandboxControlSchema.parse({
    ...drainingControl,
    blueDeploymentId: replacementBlue.id,
    activeDeploymentId: replacementBlue.id,
    updatedAt: "2026-07-31T12:00:30.000Z"
  })), /sandbox_slot_is_draining/);

  const answeredFirst = required(await repository.saveAgentRun(siteAgentRunSchema.parse({
    ...firstPause.run,
    status: "queued",
    stage: "queued"
  })));
  const secondInput = siteInputWithId(firstInput, "input_blue_green_latest");
  await repository.savePublicBuildInput(secondInput);
  await repository.setCurrentPublicBuildInput(firstInput.siteId, secondInput.id);
  const restarted = required(await repository.claimAgentRun(answeredFirst.id));
  assert.equal(restarted.sandboxDeploymentId, green.id, "The resumed execution was not pinned to the newly active deployment.");
  assert.equal(restarted.publicBuildInputId, secondInput.id, "Claim did not refresh the locked public input.");
  assert.equal(restarted.resumeCheckpointId, undefined, "Stale paused source survived claim-time compatibility checking.");
  assert(restarted.checkpointRestartedAt, "The same logical run did not record its source restart.");
  assert.equal((await repository.getAgentSession(session.id))?.publicBuildInputId, firstInput.id, "Claim rewrote the live sandbox's recorded public-input provenance before recycling it.");
  assert.equal((await repository.getAgentWorkspaceCheckpoint(staleCheckpoint.id))?.id, staleCheckpoint.id, "A stale checkpoint was deleted instead of retained for audit.");
  const staleWorkerWrite = siteAgentRunSchema.parse({ ...firstPause.run, status: "succeeded", stage: "candidate_ready", completedAt: createdAt });
  assert.equal((await repository.saveAgentRun(staleWorkerWrite)).executionNumber, restarted.executionNumber, "An old execution committed after the claim fence advanced.");

  await repository.saveAgentRun(siteAgentRunSchema.parse({ ...restarted, status: "cancelled", stage: "failed", completedAt: createdAt }));
  session = siteAgentSessionSchema.parse({
    ...required(await repository.getAgentSession(session.id)),
    status: "checkpointed",
    sandboxDeploymentId: undefined,
    sandboxId: undefined,
    updatedAt: createdAt
  });
  await repository.saveAgentSession(session);
  assert.deepEqual(await repository.getSandboxDeploymentDrain(blueDeploymentId), { runningRunIds: [], liveSessionIds: [] }, "Retained checkpoint history blocked blue-slot reuse.");

  const secondQueued = await repository.enqueueAgentRun(buildRun("run_blue_green_current", secondInput.id));
  const secondClaim = required(await repository.claimNextAgentRun("queue-worker"));
  assert.equal(secondClaim.id, secondQueued.id, "The canonical queue claim selected the wrong run.");
  assert.equal(secondClaim.sandboxDeploymentId, green.id);
  session = await bindSandbox(session, secondClaim, "sandbox_green_warm");
  const currentCheckpoint = buildCheckpoint(secondClaim, session, "b");
  const secondPause = await repository.pauseAgentRunForInput({
    checkpoint: currentCheckpoint,
    run: waitingRun(secondClaim, currentCheckpoint.id),
    session: pausedSession(session)
  });
  await repository.saveAgentRun(siteAgentRunSchema.parse({ ...secondPause.run, status: "queued", stage: "queued" }));
  const greenControl = required(await repository.getSandboxControl());
  await repository.saveSandboxControl(siteSandboxControlSchema.parse({
    ...greenControl,
    activeDeploymentId: blueDeploymentId,
    updatedAt: "2026-07-31T12:03:00.000Z"
  }));
  const restoredAcrossSlots = required(await repository.claimAgentRun(secondPause.run.id));
  assert.equal(restoredAcrossSlots.sandboxDeploymentId, blueDeploymentId);
  assert.equal(restoredAcrossSlots.resumeCheckpointId, currentCheckpoint.id, "A current source checkpoint was discarded only because the active slot changed.");
  session = await bindSandbox(session, restoredAcrossSlots, "sandbox_blue_rollback");
  const affected = await repository.rollbackSandboxDeployment({
    failedDeploymentId: blueDeploymentId,
    previousDeploymentId: green.id,
    now: createdAt
  });
  assert.deepEqual(affected, [restoredAcrossSlots.id]);
  const rollbackQueued = required(await repository.getAgentRun(restoredAcrossSlots.id));
  assert.equal(rollbackQueued.status, "queued");
  assert.equal(rollbackQueued.executionNumber, restoredAcrossSlots.executionNumber + 1, "Rollback did not fence the failed execution before requeueing.");
  const rotating = required(await repository.getAgentSession(session.id));
  assert.equal(rotating.status, "rotating");
  assert.equal(await repository.claimNextAgentRun("blocked-by-live-failed-slot"), undefined, "A rollback requeue claimed before its failed-slot sandbox was destroyed.");
  assert(await repository.fenceExpiredAgentSession({ session: rotating, now: createdAt }), "Rollback cleanup could not fence the rotating live session.");
  session = siteAgentSessionSchema.parse({
    ...rotating,
    status: "checkpointed",
    sandboxDeploymentId: undefined,
    sandboxId: undefined,
    updatedAt: createdAt
  });
  await repository.saveAgentSession(session);
  const recoveredAfterRollback = required(await repository.claimNextAgentRun("rollback-recovery"));
  assert.equal(recoveredAfterRollback.id, restoredAcrossSlots.id);
  assert.equal(recoveredAfterRollback.sandboxDeploymentId, green.id);
  const recoveredFence = required(await repository.requeueInterruptedAgentRun({
    runId: recoveredAfterRollback.id,
    executionNumber: recoveredAfterRollback.executionNumber,
    now: createdAt,
    failureReason: "interrupted_run_resuming_from_continuation"
  }));
  assert.equal(recoveredFence.executionNumber, recoveredAfterRollback.executionNumber + 1, "Recovery requeued without fencing its old worker.");
  assert.equal(await repository.saveAgentSessionForExecution(
    required(await repository.getAgentSession(session.id)),
    recoveredAfterRollback.id,
    recoveredAfterRollback.executionNumber
  ), false, "A stale execution rewrote the session after its recovery fence advanced.");
  assert.equal((await repository.saveAgentRun(siteAgentRunSchema.parse({ ...recoveredAfterRollback, status: "succeeded", stage: "candidate_ready", completedAt: createdAt }))).executionNumber, recoveredFence.executionNumber);
  const finalClaim = required(await repository.claimAgentRun(recoveredAfterRollback.id));
  await repository.saveAgentRun(siteAgentRunSchema.parse({ ...finalClaim, status: "cancelled", stage: "failed", completedAt: createdAt }));
  assert.deepEqual(await repository.getSandboxDeploymentDrain(green.id), { runningRunIds: [], liveSessionIds: [] }, "Checkpoint history blocked green-slot reuse after its warm sandbox was destroyed.");

  const formQueued = await repository.enqueueAgentRun(buildRun("run_managed_form_fence", secondInput.id));
  const staleFormExecution = required(await repository.claimAgentRun(formQueued.id));
  const nextForm = formDefinitionSchema.parse({
    ...secondInput.forms[0],
    id: "form_managed_fence",
    revision: secondInput.forms[0].revision + 1,
    name: "Execution-fenced request"
  });
  const nextIntent = siteIntentSchema.parse({
    ...firstInput.intent,
    revision: firstInput.intent.revision + 1,
    ownerIntentRevision: firstInput.intent.ownerIntentRevision + 1,
    intentHash: hash("e"),
    updatedAt: createdAt
  });
  const nextInput = sitePublicBuildInputSchema.parse({
    ...secondInput,
    id: "input_managed_form_fence",
    ownerIntentRevision: nextIntent.ownerIntentRevision,
    inputHash: hash("f"),
    intent: nextIntent,
    forms: [nextForm],
    createdAt
  });
  const staleFormSession = siteAgentSessionSchema.parse({
    ...required(await repository.getAgentSession(session.id)),
    publicBuildInputId: nextInput.id,
    updatedAt: createdAt
  });
  const staleFormRun = siteAgentRunSchema.parse({ ...staleFormExecution, publicBuildInputId: nextInput.id });
  await repository.requeueInterruptedAgentRun({
    runId: staleFormExecution.id,
    executionNumber: staleFormExecution.executionNumber,
    now: createdAt,
    failureReason: "test_execution_fence"
  });
  assert.equal(await repository.applyManagedFormAuthoringChange({
    expectedPublicBuildInputId: secondInput.id,
    expectedIntentRevision: firstInput.intent.revision,
    form: nextForm,
    siteIntent: nextIntent,
    publicBuildInput: nextInput,
    session: staleFormSession,
    run: staleFormRun
  }), undefined, "A stale worker advanced managed-form authority after its execution was fenced.");
  assert.equal((await repository.getSiteIntent(firstInput.siteId))?.revision, firstInput.intent.revision);
  assert.equal(await repository.getFormDefinition(nextForm.id), undefined);
  assert.equal((await repository.getSite(firstInput.siteId))?.currentPublicBuildInputId, secondInput.id);

  const currentFormExecution = required(await repository.claimAgentRun(formQueued.id));
  const currentFormSession = siteAgentSessionSchema.parse({
    ...required(await repository.getAgentSession(session.id)),
    publicBuildInputId: nextInput.id,
    updatedAt: createdAt
  });
  const currentFormRun = siteAgentRunSchema.parse({ ...currentFormExecution, publicBuildInputId: nextInput.id });
  const appliedForm = required(await repository.applyManagedFormAuthoringChange({
    expectedPublicBuildInputId: secondInput.id,
    expectedIntentRevision: firstInput.intent.revision,
    form: nextForm,
    siteIntent: nextIntent,
    publicBuildInput: nextInput,
    session: currentFormSession,
    run: currentFormRun
  }));
  assert.equal(appliedForm.run.publicBuildInputId, nextInput.id);
  assert.equal(appliedForm.session.publicBuildInputId, nextInput.id);
  assert.equal((await repository.getSiteIntent(firstInput.siteId))?.revision, nextIntent.revision);
  assert.equal((await repository.getSite(firstInput.siteId))?.currentPublicBuildInputId, nextInput.id);
  await repository.saveAgentRun(siteAgentRunSchema.parse({ ...appliedForm.run, status: "cancelled", stage: "failed", completedAt: createdAt }));
} finally {
  await rm(directory, { recursive: true, force: true });
}

process.stdout.write("Canonical claims, durable pauses, source compatibility, deployment pinning, and stale-worker fencing verified.\n");

function buildRun(id: string, publicBuildInputId: string) {
  return siteAgentRunSchema.parse({
    schemaVersion: "site-agent-run",
    id,
    sessionId: "session_blue_green_test",
    siteId: "site_synthetic_verification",
    publicBuildInputId,
    request: { kind: "owner_instruction", messageIds: [`message_${id}`] },
    origin: "owner_request",
    requestedBy: ownerId,
    kind: "edit",
    status: "queued",
    stage: "queued",
    executionNumber: 0,
    apiProvider: "openai",
    modelId: "gpt-5.6-sol",
    skillVersions: {},
    guardrails: siteAgentRunGuardrailsForKind("edit", createdAt),
    usage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costSource: "unavailable",
      upstreamInferenceCostUsd: 0,
      durationMs: 0
    },
    startedAt: createdAt
  });
}

async function bindSandbox(current: SiteAgentSession, run: SiteAgentRun, sandboxId: string) {
  const bound = siteAgentSessionSchema.parse({
    ...current,
    status: "active",
    sandboxDeploymentId: run.sandboxDeploymentId,
    sandboxId,
    publicBuildInputId: run.publicBuildInputId,
    leaseExpiresAt: "2026-08-01T12:00:00.000Z",
    updatedAt: createdAt
  });
  await repository.saveAgentSession(bound);
  return bound;
}

function buildCheckpoint(run: SiteAgentRun, bound: SiteAgentSession, character: string, executionNumber = run.executionNumber) {
  const backupId = character.repeat(64);
  return siteAgentWorkspaceCheckpointSchema.parse({
    schemaVersion: 1,
    id: `checkpoint_${character}`,
    runId: run.id,
    executionNumber,
    baseWorkspaceRevisionId: run.exactParentRevisionId,
    publicBuildInputId: run.publicBuildInputId,
    sandboxDeploymentId: required(run.sandboxDeploymentId),
    sandboxId: required(bound.sandboxId),
    sandboxRevision: `revision_${character}`,
    workspaceHash: hash(character),
    backup: { id: backupId, key: `workspace-backups/${backupId}.tar.gz`, contentHash: hash(character), bytes: 100 },
    sidecar: { key: `workspace-sources/${backupId}.json`, contentHash: hash(character === "f" ? "e" : "f"), bytes: 200 },
    producer: "site-authoring-platform@test",
    modelId: run.modelId,
    skillIdentity: "site-authoring-skill@test",
    inputHash: hash("9"),
    createdAt
  });
}

function waitingRun(run: SiteAgentRun, checkpointId: string) {
  return siteAgentRunSchema.parse({
    ...run,
    status: "needs_input",
    stage: "needs_input",
    inputQuestion: "Which direction should we use?",
    resumeCheckpointId: checkpointId
  });
}

function pausedSession(current: SiteAgentSession) {
  return siteAgentSessionSchema.parse({
    ...current,
    status: "checkpointed",
    leaseExpiresAt: "2026-07-31T12:05:00.000Z",
    updatedAt: createdAt
  });
}

function siteInputWithId<T extends { id: string }>(input: T, id: string): T {
  return { ...input, id };
}

function hash(character: string) {
  return `sha256:${character.repeat(64)}` as const;
}

function required<T>(value: T | undefined | null): T {
  assert(value !== undefined && value !== null);
  return value;
}
