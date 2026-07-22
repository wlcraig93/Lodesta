import { processProspectReportJobs } from "@/lib/prospect-report-jobs";
import { siteAuthoringWorkflow, siteAgentRecoveryStaleAfterMs } from "@/packages/site-platform";

export const automaticRecoveryLimit = 4;

export async function processAutomaticRecovery(trigger: "startup" | "cloudflare_cron") {
  const agentRuns = await siteAuthoringWorkflow.processRecoverableRuns({
    limit: automaticRecoveryLimit,
    staleAfterMs: siteAgentRecoveryStaleAfterMs
  });
  const prospectReports = await processProspectReportJobs({
    limit: automaticRecoveryLimit,
    workerId: `${trigger}-${process.pid}`
  });
  const result = { trigger, agentRuns, prospectReports };
  console.log(JSON.stringify({
    event: "automatic_recovery_completed",
    trigger,
    reaped: agentRuns.reaped.length,
    recovered: agentRuns.recovered.length,
    processed: agentRuns.processed.length,
    prospectReports: prospectReports.length
  }));
  return result;
}
