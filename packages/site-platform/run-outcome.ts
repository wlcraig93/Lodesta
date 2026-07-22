import type { SiteAgentRunV2 } from "../site-contracts";

export function candidateAttemptForRun(run: SiteAgentRunV2) {
  if (!run.outputRevisionId || !run.candidateVersionId) return undefined;
  return [...run.attempts].reverse().find((attempt) =>
    attempt.hardGate === "passed"
    && attempt.workspaceRevisionId === run.outputRevisionId
  );
}
