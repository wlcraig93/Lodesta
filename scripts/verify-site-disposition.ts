import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSitePlatformRepository } from "@/packages/platform-data/repository";
import { siteAgentRunSchema, siteAgentSessionSchema } from "@/packages/site-contracts";
import { siteAgentRunGuardrailsForKind } from "@/packages/site-agent";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const ownerId = "63ee1944-0c01-4ccf-ad39-4d2f02b281ac";
const otherOwnerId = "a46b99dd-d8e2-4f24-9957-fd2564cb79ec";
const directory = await mkdtemp(join(tmpdir(), "lodesta-site-disposition-"));
const repository = new LocalSitePlatformRepository(join(directory, "repository.json"));
const createdAt = new Date().toISOString();
const buildInput = buildSyntheticSiteInput();

try {
  await repository.createSite({
    id: buildInput.siteId,
    ownerUserId: ownerId,
    businessId: buildInput.businessId,
    slug: "disposition-test",
    status: "active",
    reportingTimezone: "UTC",
    publishedVersionId: "version_retained_test",
    currentPublicBuildInputId: buildInput.id,
    createdAt,
    updatedAt: createdAt
  });
  await repository.savePublicBuildInput(buildInput);
  await repository.saveAgentSession(siteAgentSessionSchema.parse({
    schemaVersion: "site-agent-session",
    id: "session_disposition_test",
    siteId: buildInput.siteId,
    principal: { kind: "owner", id: ownerId },
    status: "active",
    publicBuildInputId: buildInput.id,
    sandboxProvider: "cloudflare",
    leaseTokenHash: `sha256:${"a".repeat(64)}`,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    rotateAt: new Date(Date.now() + 120_000).toISOString(),
    createdAt,
    updatedAt: createdAt
  }));
  await repository.enqueueAgentRun(siteAgentRunSchema.parse({
    schemaVersion: "site-agent-run",
    id: "run_disposition_test",
    sessionId: "session_disposition_test",
    siteId: buildInput.siteId,
    publicBuildInputId: buildInput.id,
    request: { kind: "owner_instruction", messageIds: ["message_disposition_test"] },
    origin: "owner_request",
    apiProvider: "openai",
    modelId: "gpt-5.4",
    requestedBy: ownerId,
    kind: "edit",
    status: "queued",
    stage: "queued",
    executionNumber: 0,
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
  }));
  const claimedRun = await repository.claimAgentRun("run_disposition_test");
  assert.equal(claimedRun?.status, "running", "The queued run was not atomically claimed.");
  assert.equal(claimedRun?.executionNumber, 1, "Claiming did not fence the run with a new execution number.");
  assert(claimedRun?.heartbeatAt, "Claiming did not establish a recovery heartbeat.");
  assert.equal(
    await repository.touchAgentRunHeartbeat("run_disposition_test", 1, new Date().toISOString()),
    true,
    "A running execution could not refresh its durable heartbeat."
  );

  assert.equal(
    await repository.disposeOwnedSite(buildInput.siteId, otherOwnerId),
    undefined,
    "A non-owner disposed the site."
  );
  assert.equal((await repository.getSite(buildInput.siteId))?.ownerUserId, ownerId);

  const disposed = await repository.disposeOwnedSite(buildInput.siteId, ownerId);
  assert.equal(disposed?.status, "paused");
  assert.equal(disposed?.ownerUserId, undefined);
  assert.equal(disposed?.publishedVersionId, "version_retained_test", "Disposition removed the retained published version reference.");
  assert.equal((await repository.getSitesByOwnerUserId(ownerId)).length, 0, "Disposed site remains in the owner inventory.");
  assert.equal((await repository.getAgentRun("run_disposition_test"))?.status, "cancelled", "Disposition did not cancel active authoring.");
  const cancelledRun = await repository.getAgentRun("run_disposition_test");
  const staleUpdate = cancelledRun && siteAgentRunSchema.parse({
    ...cancelledRun,
    status: "running",
    stage: "authoring",
    completedAt: undefined
  });
  if (staleUpdate) {
    assert.equal((await repository.saveAgentRun(staleUpdate)).status, "cancelled", "A stale worker resurrected a cancelled run.");
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("Site disposition verification passed.");
