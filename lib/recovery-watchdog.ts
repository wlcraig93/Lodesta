import { processWebsiteAssessmentJobs } from "@/packages/website-assessment/jobs";
import { siteAuthoringWorkflow, siteAgentRecoveryStaleAfterMs } from "@/packages/site-platform";
import { processDomainReconciliations } from "@/lib/domain-reconciliation";

export const automaticRecoveryLimit = 4;

export async function processAutomaticRecovery(trigger: "startup" | "cloudflare_cron") {
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
  const result = { trigger, agentRuns, websiteAssessments, domains };
  console.log(JSON.stringify({
    event: "automatic_recovery_completed",
    trigger,
    reaped: agentRuns.reaped.length,
    recovered: agentRuns.recovered.length,
    processed: agentRuns.processed.length,
    websiteAssessments: websiteAssessments.length,
    domains: domains.length
  }));
  return result;
}
