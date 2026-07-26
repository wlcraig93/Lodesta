import { processWebsiteAssessmentJobs } from "@/packages/website-assessment/jobs";
import { siteAuthoringWorkflow, siteAgentRecoveryStaleAfterMs } from "@/packages/site-platform/workflow";
import { processDomainReconciliations } from "@/lib/domain-reconciliation";
import { processNextWebsiteSetupAndRun } from "@/lib/website-setup-jobs";

export const automaticRecoveryLimit = 4;

export async function processAutomaticRecovery(trigger: "startup" | "cloudflare_cron") {
  const agentRuns = await siteAuthoringWorkflow.processRecoverableRuns({
    limit: automaticRecoveryLimit,
    staleAfterMs: siteAgentRecoveryStaleAfterMs
  });
  const websiteSetup = await processNextWebsiteSetupAndRun(`${trigger}-website-setup-${process.pid}`);
  const [websiteAssessments, domains] = await Promise.all([
    processWebsiteAssessmentJobs({
      limit: automaticRecoveryLimit,
      workerId: `${trigger}-${process.pid}`
    }),
    processDomainReconciliations({ limit: automaticRecoveryLimit })
  ]);
  const result = { trigger, agentRuns, websiteSetup, websiteAssessments, domains };
  console.log(JSON.stringify({
    event: "automatic_recovery_completed",
    trigger,
    reaped: agentRuns.reaped.length,
    recovered: agentRuns.recovered.length,
    processed: agentRuns.processed.length,
    websiteSetup: websiteSetup?.setupId,
    websiteAssessments: websiteAssessments.length,
    domains: domains.length
  }));
  return result;
}
