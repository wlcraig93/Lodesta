import type { SiteAgentRun } from "@/packages/site-contracts";

export type OwnerSiteAgentRun = Pick<
  SiteAgentRun,
  "id" | "kind" | "status" | "stage" | "startedAt" | "fastPreviewPath" | "inputQuestion" | "retryableByOwner"
>;

export function ownerSiteAgentRun(run: SiteAgentRun): OwnerSiteAgentRun {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    stage: run.stage,
    startedAt: run.startedAt,
    fastPreviewPath: run.fastPreviewPath,
    inputQuestion: run.inputQuestion,
    retryableByOwner: run.retryableByOwner
  };
}
