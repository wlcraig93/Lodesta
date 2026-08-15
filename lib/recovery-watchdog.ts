import { randomUUID } from "node:crypto";
import { processWebsiteAssessmentJobs } from "@/packages/website-assessment/jobs";
import { siteAuthoringWorkflow, siteAgentRecoveryStaleAfterMs } from "@/packages/site-platform/workflow";
import { processDomainReconciliations } from "@/lib/domain-reconciliation";
import { sitePlatformRepository } from "@/packages/platform-data";
import { operatorQueueItemSchema, siteSandboxManifestSchema } from "@/packages/site-contracts";
import { configuredSiteSandboxRuntimeForDeployment } from "@/packages/site-sandbox";

export const automaticRecoveryLimit = 4;

export async function processAutomaticRecovery(trigger: "startup" | "cloudflare_cron") {
  const drainingSandbox = await inspectDrainingSandboxDeployment();
  const agentRuns = await siteAuthoringWorkflow.processRecoverableRuns({
    limit: automaticRecoveryLimit,
    staleAfterMs: siteAgentRecoveryStaleAfterMs
  });
  const [websiteAssessments, domains] = await Promise.all([
    processWebsiteAssessmentJobs({
      limit: automaticRecoveryLimit,
      workerId: `${trigger}-${process.pid}`
    }),
    processDomainReconciliations({ limit: automaticRecoveryLimit })
  ]);
  const result = { trigger, drainingSandbox, agentRuns, websiteAssessments, domains };
  console.log(JSON.stringify({
    event: "automatic_recovery_completed",
    trigger,
    reaped: agentRuns.reaped.length,
    recovered: agentRuns.recovered.length,
    processed: agentRuns.processed.length,
    drainingSandbox: drainingSandbox.state,
    websiteAssessments: websiteAssessments.length,
    domains: domains.length
  }));
  return result;
}

export async function inspectDrainingSandboxDeployment(fetcher: typeof fetch = fetch) {
  if (process.env.NODE_ENV !== "production") return { state: "not_applicable" as const };
  const control = await sitePlatformRepository.getSandboxControl();
  if (!control) return { state: "unconfigured" as const };
  const inactiveDeploymentId = control.activeDeploymentId === control.blueDeploymentId
    ? control.greenDeploymentId
    : control.blueDeploymentId;
  if (!inactiveDeploymentId) return { state: "no_inactive_deployment" as const };
  const drain = await sitePlatformRepository.getSandboxDeploymentDrain(inactiveDeploymentId);
  if (!drain.runningRunIds.length && !drain.liveSessionIds.length) {
    return { state: "standby" as const, deploymentId: inactiveDeploymentId };
  }
  const deployment = await sitePlatformRepository.getSandboxDeployment(inactiveDeploymentId);
  if (!deployment) throw new Error(`Draining sandbox deployment ${inactiveDeploymentId} is missing.`);
  try {
    const runtime = configuredSiteSandboxRuntimeForDeployment(deployment);
    const response = await fetcher(`${runtime.url.replace(/\/$/, "")}/health`, {
      headers: { authorization: `Bearer ${runtime.token}` },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error(`health returned ${response.status}`);
    const payload = await response.json() as { sandboxManifest?: unknown };
    const manifest = siteSandboxManifestSchema.parse(payload.sandboxManifest);
    if (JSON.stringify(manifest) !== JSON.stringify(deployment.manifest)) {
      throw new Error("health manifest differs from the immutable deployment record");
    }
    return { state: "healthy" as const, deploymentId: inactiveDeploymentId, drain };
  } catch (cause) {
    const now = new Date().toISOString();
    const [runs, sessions, queue] = await Promise.all([
      Promise.all(drain.runningRunIds.map((runId) => sitePlatformRepository.getAgentRun(runId))),
      Promise.all(drain.liveSessionIds.map((sessionId) => sitePlatformRepository.getAgentSession(sessionId))),
      sitePlatformRepository.listOperatorQueue()
    ]);
    const siteIds = [...new Set([
      ...runs.flatMap((run) => run ? [run.siteId] : []),
      ...sessions.flatMap((session) => session ? [session.siteId] : [])
    ])];
    const message = cause instanceof Error ? cause.message : String(cause);
    for (const siteId of siteIds) {
      const exists = queue.some((item) => item.siteId === siteId
        && item.reason === "maintenance_failure"
        && !["resolved", "dismissed"].includes(item.status)
        && item.findings.some((finding) => finding.deploymentId === inactiveDeploymentId));
      if (exists) continue;
      await sitePlatformRepository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
        schemaVersion: "operator-queue-item",
        id: `operator_sandbox_${randomUUID().replaceAll("-", "")}`,
        siteId,
        reason: "maintenance_failure",
        severity: "high",
        status: "open",
        findings: [{ kind: "draining_sandbox_unhealthy", deploymentId: inactiveDeploymentId, message }],
        createdAt: now,
        updatedAt: now
      }));
    }
    await Promise.all(drain.runningRunIds.map((runId) => siteAuthoringWorkflow.recoverRunIfStale(runId)));
    console.error(JSON.stringify({ event: "draining_sandbox_unhealthy", deploymentId: inactiveDeploymentId, ...drain, message }));
    return { state: "unhealthy" as const, deploymentId: inactiveDeploymentId, drain, message };
  }
}
