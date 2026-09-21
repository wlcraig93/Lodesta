import { siteAuthoringWorkflow, siteAgentRecoveryStaleAfterMs } from "@/packages/site-platform/workflow";
import { processDomainReconciliations } from "@/lib/domain-reconciliation";

export const automaticRecoveryLimit = 4;

export async function processAutomaticRecovery(trigger: "startup" | "cloudflare_cron") {
  const agentRuns = await siteAuthoringWorkflow.recoverSiteAuthoring({
    limit: automaticRecoveryLimit,
    staleAfterMs: siteAgentRecoveryStaleAfterMs
  });
  const domains = await processDomainReconciliations({ limit: automaticRecoveryLimit });
  const result = { trigger, agentRuns, domains };
  console.log(JSON.stringify({
    event: "automatic_recovery_completed",
    trigger,
    reaped: agentRuns.reaped.length,
    recovered: agentRuns.recovered.length,
    domains: domains.length
  }));
  return result;
}
