import type { SiteAgentRun } from "@/packages/site-contracts";

/**
 * A retained run normally records retry eligibility at failure time. The
 * zero-cost initial-source exception also recognizes the two immutable mirror
 * conflicts produced by the former undefined-vs-SQL-null verifier so affected
 * pre-launch runs can resume through the ordinary owner retry path.
 */
export function ownerCanRetrySiteAgentRun(run: SiteAgentRun) {
  if (run.retryableByOwner) return true;
  return run.status === "failed"
    && run.kind === "initial_build"
    && run.usage.inputTokens === 0
    && run.usage.outputTokens === 0
    && !run.outputRevisionId
    && !run.candidateVersionId
    && /^(?:source_snapshot_resource_conflict|source_snapshot_page_conflict)$/.test(run.failureReason ?? "");
}
