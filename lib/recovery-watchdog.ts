import { processProspectReportJobs } from "@/packages/acquisition/prospect-report-jobs";
import { siteAuthoringWorkflow, siteAgentRecoveryStaleAfterMs } from "@/packages/site-platform";
import { processDomainReconciliations } from "@/lib/domain-reconciliation";

export const automaticRecoveryLimit = 4;

export async function processAutomaticRecovery(trigger: "startup" | "cloudflare_cron") {
  const agentRuns = await siteAuthoringWorkflow.processRecoverableRuns({
    limit: automaticRecoveryLimit,
    staleAfterMs: siteAgentRecoveryStaleAfterMs
  });
  const [prospectReports, domains] = await Promise.all([
    processProspectReportJobs({
      limit: automaticRecoveryLimit,
      workerId: `${trigger}-${process.pid}`
    }),
    processDomainReconciliations({ limit: automaticRecoveryLimit })
  ]);
  const result = { trigger, agentRuns, prospectReports, domains };
  console.log(JSON.stringify({
    event: "automatic_recovery_completed",
    trigger,
    reaped: agentRuns.reaped.length,
    recovered: agentRuns.recovered.length,
    processed: agentRuns.processed.length,
    prospectReports: prospectReports.length,
    domains: domains.length
  }));
  return result;
}
