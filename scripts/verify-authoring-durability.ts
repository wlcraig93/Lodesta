import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [worker, dev, workflow, manager, history, repository, migration, sandboxMigration, verificationMigration, contracts, runtimeConfig, recoveryConfig, route] = await Promise.all([
  readFile("workers/runner.ts", "utf8"),
  readFile("scripts/dev.mjs", "utf8"),
  readFile("packages/site-platform/workflow.ts", "utf8"),
  readFile("packages/site-agent/manager.ts", "utf8"),
  readFile("packages/site-agent/history.ts", "utf8"),
  readFile("packages/platform-data/repository.ts", "utf8"),
  readFile("supabase/migrations/202607300004_durable_single_path_site_authoring.sql", "utf8"),
  readFile("supabase/migrations/202607310003_minimal_blue_green_sandboxes.sql", "utf8"),
  readFile("supabase/migrations/202608040003_checkpointed_verification_and_luna_authoring.sql", "utf8"),
  readFile("packages/site-contracts/index.ts", "utf8"),
  readFile("packages/site-sandbox/runtime-config.ts", "utf8"),
  readFile("workers/recovery-watchdog/wrangler.jsonc", "utf8"),
  readFile("app/api/site-agent/sites/route.ts", "utf8")
]);

assert(worker.includes("processRecoverableRuns"));
assert(worker.includes("250"));
assert(worker.includes("2_000"));
assert(dev.includes("workers/runner.ts"));
assert(dev.includes("function stop"));
assert(dev.includes('child.kill("SIGKILL")'));
assert(!route.includes("after("));
assert(workflow.includes("60_000"));
assert(workflow.includes("siteAgentRecoveryStaleAfterMs = 5 * 60_000"));
assert(workflow.includes("loadManagerContinuation"));
assert(workflow.includes("appendAgentContinuation"));
assert(workflow.includes("executionNumber"));
assert(manager.includes("onContinuation"));
assert(manager.includes("onContinuationReset"));
assert(history.includes("drainContinuationItems"));
assert(repository.includes("site_agent_continuation_heads"));
assert(repository.includes("site_agent_continuation_segments"));
assert(migration.includes("continuation_execution_fenced"));
assert(migration.includes("latest_sequence + 1"));
assert(sandboxMigration.includes("create table public.site_sandbox_deployments"));
assert(sandboxMigration.includes("create table public.site_sandbox_control"));
assert(sandboxMigration.includes("create table public.site_agent_workspace_checkpoints"));
assert(sandboxMigration.includes("create function public.claim_site_agent_run"));
assert(sandboxMigration.includes("drop function if exists public.claim_next_site_agent_run"));
assert(sandboxMigration.includes("site-sandbox-control"));
assert(sandboxMigration.includes("sandbox_slot_is_draining"));
assert(sandboxMigration.includes("checkpoint_current"));
assert(sandboxMigration.includes("checkpoint_execution_fenced"));
assert(sandboxMigration.includes("fence_expired_site_agent_session"));
assert(sandboxMigration.includes("requeue_interrupted_site_agent_run"));
assert(workflow.includes("requeueInterruptedAgentRun"));
assert(sandboxMigration.includes("save_site_agent_session_for_execution"));
assert(workflow.includes("saveSessionForExecution"));
assert(sandboxMigration.includes("interval '5 minutes'"));
assert(workflow.includes("pauseRunForInput"));
assert(!workflow.includes("checkpointForVerification"));
assert(workflow.includes("checkpointRetryableFailure"));
assert(workflow.includes('failure.code === "cost_limit_exhausted"'));
assert(workflow.includes('failure.code === "deadline_exhausted"'));
assert(workflow.includes("latest.resumeCheckpointId && !latest.authoringProfileId"));
assert(workflow.includes("captureWorkspaceCheckpoint"));
assert(workflow.includes("checkpoint_backup_verification_failed"));
assert(workflow.includes("retryTransientAuthoringPersistence(() => this.sandbox.getSource(session.sandboxId!))"));
assert(workflow.includes("retryTransientAuthoringPersistence(() => this.sandbox.backup(session.sandboxId!))"));
assert(workflow.includes("retryTransientAuthoringPersistence(() => this.blobStore.putImmutable({"));
assert(workflow.includes("never misreport a telemetry write outage as a"));
assert(workflow.includes("retryTransientAuthoringPersistence(() => recorder.close(attemptSpan"));
assert(workflow.includes("resume_checkpoint_sidecar_mismatch"));
assert(workflow.includes("fenceExpiredAgentSession"));
assert(!workflow.includes("inputExpiresAt"));
assert(contracts.includes("siteAgentWorkspaceCheckpointSchema"));
assert(contracts.includes("sandboxDeploymentId"));
assert(!contracts.includes("inputExpiresAt"));
assert(runtimeConfig.includes("LODESTA_SANDBOX_BLUE"));
assert(runtimeConfig.includes("LODESTA_SANDBOX_GREEN"));
assert(!runtimeConfig.includes("environment.LODESTA_SANDBOX_URL"));
assert(recoveryConfig.includes('"* * * * *"'));
assert(verificationMigration.includes("checkpoint_site_agent_run_workspace"));
assert(verificationMigration.includes("requeue_checkpointed_site_agent_run"));
assert(repository.includes("checkpointAgentRunWorkspace"));
assert(repository.includes("requeueCheckpointedAgentRun"));

process.stdout.write("Process-resumable authoring, durable pauses, blue-green pinning, and stale-worker fencing verified.\n");
