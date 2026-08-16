import "./load-env";

import assert from "node:assert/strict";
import { sha256, stableJson } from "../packages/business-data";
import { sitePublicBuildInputSchema, type SitePublicBuildInput } from "../packages/site-contracts";
import { sitePlatformRepository } from "../packages/platform-data";

const apply = process.argv.includes("--apply");
const actorId = option("--verified-by=");
const approvedOwnerSites = new Set(process.argv.filter((value) => value.startsWith("--approved-owner-site=")).map((value) => value.slice("--approved-owner-site=".length)));
const targetSeries = "site-runtime-v4";

if (apply && (!actorId || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(actorId))) {
  throw new Error("Use --apply --verified-by=<operator-id> after the V4 diagnostic, treatment screen, and release verification pass.");
}
if (apply) {
  assert(await sitePlatformRepository.isMaintenanceLeaseActive("site_authoring_maintenance", new Date().toISOString()), "The V4 cutover requires the active site-authoring maintenance lease.");
  const [running, queued] = await Promise.all([
    sitePlatformRepository.listRecentAgentRuns({ status: "running", limit: 1 }),
    sitePlatformRepository.listRecentAgentRuns({ status: "queued", limit: 1 })
  ]);
  assert.equal(running.length, 0, "The V4 cutover requires zero running authoring runs.");
  assert.equal(queued.length, 0, "The V4 cutover requires zero queued authoring runs.");
  const series = await sitePlatformRepository.getRuntimeSeries(targetSeries);
  assert(series, "The V4 runtime series must be promoted before current inputs are repointed.");
  const activePatch = await sitePlatformRepository.getRuntimePatch(series.activePatchId);
  assert(activePatch?.securityStatus === "audited" && activePatch.compatibilityStatus === "passed", "The active V4 runtime patch must be audited and compatibility-passed.");
}

const [sites, revisions, inputs] = await Promise.all([
  sitePlatformRepository.listSites(),
  sitePlatformRepository.listWorkspaceRevisions(),
  sitePlatformRepository.listPublicBuildInputs()
]);
const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
const inputById = new Map(inputs.map((input) => [input.id, input]));
const changes: Array<Record<string, unknown>> = [];

for (const site of sites) {
  if (!site.currentPublicBuildInputId) {
    changes.push({ siteId: site.id, status: "skipped_no_current_input" });
    continue;
  }
  const prior = inputById.get(site.currentPublicBuildInputId);
  if (!prior) throw new Error(`Site ${site.id} references missing public input ${site.currentPublicBuildInputId}.`);
  if (prior.capabilityConfiguration.trustedRuntimeSeries === targetSeries) {
    changes.push({ siteId: site.id, status: "already_v4", inputId: prior.id });
    continue;
  }
  const currentRevision = site.currentWorkspaceRevisionId ? revisionById.get(site.currentWorkspaceRevisionId) : undefined;
  if (currentRevision?.createdBy.kind === "owner" && !approvedOwnerSites.has(site.id)) {
    changes.push({
      siteId: site.id,
      status: "blocked_owner_approval_required",
      currentWorkspaceRevisionId: currentRevision.id,
      priorInputId: prior.id
    });
    continue;
  }

  const nextId = deterministicId("input_runtime_v4", { schemaVersion: 1, siteId: site.id, priorInputId: prior.id, runtimeSeriesId: targetSeries });
  let next = inputById.get(nextId);
  if (next) {
    assertEquivalentCutoverInput(prior, next);
  } else {
    next = cutoverInput(prior, nextId, new Date().toISOString());
    if (apply) {
      await sitePlatformRepository.savePublicBuildInput(next);
      inputById.set(next.id, next);
    }
  }
  if (apply) {
    const repointed = await sitePlatformRepository.setCurrentPublicBuildInputIfCurrent(site.id, prior.id, next.id);
    assert(repointed, `Site ${site.id} changed current input during the V4 cutover; no stale input was installed.`);
  }
  changes.push({
    siteId: site.id,
    status: apply ? "repointed" : "would_repoint",
    priorInputId: prior.id,
    nextInputId: next.id,
    priorRuntimeSeriesId: prior.capabilityConfiguration.trustedRuntimeSeries,
    nextRuntimeSeriesId: targetSeries,
    ownerRevisionApproved: currentRevision?.createdBy.kind === "owner" ? true : undefined
  });
}

const blocked = changes.filter((entry) => entry.status === "blocked_owner_approval_required");
const result = {
  ok: blocked.length === 0,
  schemaVersion: 1,
  mode: apply ? "apply" : "dry_run",
  targetRuntimeSeriesId: targetSeries,
  verifiedBy: actorId,
  approvedOwnerSiteIds: [...approvedOwnerSites].sort(),
  changes,
  rollback: {
    method: "restore the prior pinned sandbox deployment, then repoint each changed site to its priorInputId",
    priorInputReferences: changes.filter((entry) => entry.status === "repointed").map((entry) => ({ siteId: entry.siteId, inputId: entry.priorInputId }))
  }
};
const output = process.argv.includes("--summary") && !apply ? {
  ok: result.ok,
  schemaVersion: result.schemaVersion,
  mode: result.mode,
  targetRuntimeSeriesId: result.targetRuntimeSeriesId,
  statusCounts: Object.fromEntries([...new Set(changes.map((entry) => String(entry.status)))].sort().map((status) => [status, changes.filter((entry) => entry.status === status).length])),
  blockedOwnerApprovalSiteIds: blocked.map((entry) => entry.siteId)
} : result;
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (blocked.length) process.exitCode = 2;

function cutoverInput(prior: SitePublicBuildInput, id: string, createdAt: string) {
  const { inputHash: _inputHash, ...priorWithoutHash } = prior;
  const withoutHash = {
    ...priorWithoutHash,
    id,
    createdAt,
    capabilityConfiguration: {
      ...prior.capabilityConfiguration,
      trustedRuntimeSeries: targetSeries
    }
  };
  return sitePublicBuildInputSchema.parse({ ...withoutHash, inputHash: sha256(stableJson(withoutHash)) });
}

function assertEquivalentCutoverInput(prior: SitePublicBuildInput, retained: SitePublicBuildInput) {
  const expected = cutoverInput(prior, retained.id, retained.createdAt);
  assert.equal(stableJson(retained), stableJson(expected), `Retained V4 input ${retained.id} does not match its deterministic predecessor.`);
}

function deterministicId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(stableJson(value)).slice(7, 31)}`;
}

function option(prefix: string) {
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
