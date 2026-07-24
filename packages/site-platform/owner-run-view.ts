import type { SiteAgentRun } from "@/packages/site-contracts";

type OwnerRunProgress = {
  label: string;
  detail: string;
};

export type OwnerSiteAgentRun = Pick<
  SiteAgentRun,
  "id" | "kind" | "status" | "stage" | "startedAt" | "fastPreviewPath" | "inputQuestion" | "retryableByOwner"
> & {
  progress: OwnerRunProgress;
};

export function ownerSiteAgentRun(run: SiteAgentRun): OwnerSiteAgentRun {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    stage: run.stage,
    startedAt: run.startedAt,
    fastPreviewPath: run.fastPreviewPath,
    inputQuestion: run.inputQuestion,
    retryableByOwner: run.retryableByOwner,
    progress: ownerRunProgress(run)
  };
}

function ownerRunProgress(run: SiteAgentRun): OwnerRunProgress {
  if (run.status === "failed" || run.stage === "failed") {
    const specific = ({
      authoring_stalled: `The build stopped after the same release check failed ${run.guardrails?.maxConsecutiveIdenticalFailures ?? 3} times without a source change. Change the request or source before trying again; retrying the unchanged request will not help.`,
      cost_limit_exhausted: "The build reached its safety cost limit before another model turn could begin. Lodesta saved the work; ask Lodesta to review and resume it instead of repeatedly retrying.",
      cost_telemetry_unavailable: "The selected model route stopped reporting reliable cost data, so Lodesta ended the build safely. Wait for Lodesta to repair the model route before retrying.",
      browser_verification_unavailable: "Lodesta created the edit but could not complete accessibility verification. You can try this request again; the current website was not changed.",
      deadline_exhausted: "The build reached its overall time limit and Lodesta saved the work. Try a narrower request, or ask Lodesta to resume the saved work if this repeats."
    } as const)[run.failureCode as "authoring_stalled" | "cost_limit_exhausted" | "cost_telemetry_unavailable" | "browser_verification_unavailable" | "deadline_exhausted"];
    return {
      label: "Website needs attention",
      detail: specific ?? (run.retryableByOwner
        ? "The work stopped before it finished. You can try this request again."
        : "Lodesta is reviewing an internal problem. You do not need to keep retrying.")
    };
  }
  return ({
    queued: {
      label: "Preparing your website",
      detail: "Your request is ready and waiting for Lodesta to begin."
    },
    authoring: {
      label: "Designing your website",
      detail: run.kind === "initial_build"
        ? "Lodesta is turning the verified business information into a complete website."
        : "Lodesta is applying your request while preserving the rest of the website."
    },
    building: {
      label: "Building your private preview",
      detail: "The current design is being compiled into a private, reviewable website."
    },
    fast_preview: {
      label: "Preview ready; finishing checks",
      detail: "You can review the preview while Lodesta checks the final website."
    },
    verifying: {
      label: "Reviewing your website",
      detail: "Lodesta is checking routes, links, assets, forms, safety, and factual claims."
    },
    needs_input: {
      label: "Your answer is needed",
      detail: run.inputQuestion ?? "Answer the latest Lodesta question to continue this work."
    },
    candidate_ready: {
      label: "Private draft ready",
      detail: "The website passed its required checks and is ready for your review."
    },
    failed: {
      label: "Website needs attention",
      detail: "The work did not finish successfully."
    }
  } satisfies Record<SiteAgentRun["stage"], OwnerRunProgress>)[run.stage];
}
