import { createHash } from "node:crypto";
import type { SiteAgentRun, SiteAgentRunEvent } from "@/packages/site-contracts";
import { ownerCanRetrySiteAgentRun } from "@/packages/site-agent/retry-policy";

type OwnerRunProgress = {
  label: string;
  detail: string;
};

export type OwnerSiteAgentRun = Pick<
  SiteAgentRun,
  "id" | "kind" | "status" | "stage" | "startedAt" | "completedAt" | "fastPreviewPath" | "inputQuestion" | "retryableByOwner"
> & {
  progress: OwnerRunProgress;
};

export type OwnerActivityGroup = {
  key: string;
  kind: "thinking" | "review" | "edit" | "image" | "build" | "question";
  status: "running" | "succeeded" | "failed";
  label: string;
  count?: number;
  startedAt: string;
  completedAt?: string;
};

export type OwnerActivitySnapshot = {
  run: OwnerSiteAgentRun;
  activeSince?: string;
  current?: OwnerActivityGroup;
  completed: OwnerActivityGroup[];
  hasEarlierActivity: boolean;
};

const OWNER_ACTIVITY_TOOLS: Partial<Record<string, readonly [OwnerActivityGroup["kind"], string]>> = {
  list_files: ["review", "Reviewing the current website."],
  search_files: ["review", "Finding the relevant website code."],
  read_files: ["review", "Reviewing the current website."],
  write_file: ["edit", "Updating the website."],
  delete_file: ["edit", "Updating the website."],
  apply_patch: ["edit", "Updating the website."],
  edit_file: ["edit", "Updating the website."],
  create_image: ["image", "Creating an image."],
  build_preview: ["build", "Building the private preview."],
  inspect_site: ["review", "Checking the website."],
  request_input: ["question", "Preparing a question."],
  finish: ["review", "Finalizing the draft."]
};

export function ownerSiteAgentRun(run: SiteAgentRun): OwnerSiteAgentRun {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    stage: run.stage,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    fastPreviewPath: run.fastPreviewPath,
    inputQuestion: run.inputQuestion,
    retryableByOwner: ownerCanRetrySiteAgentRun(run),
    progress: ownerRunProgress(run)
  };
}

export function ownerActivitySnapshot(
  run: SiteAgentRun,
  chronologicalEvents: SiteAgentRunEvent[],
  input: { rawTailTruncated?: boolean; completedGroupLimit?: number } = {}
): OwnerActivitySnapshot {
  const mapped = chronologicalEvents.flatMap((event) => {
    const activity = ownerActivity(event);
    return activity ? [activity] : [];
  });
  const currentEvent = [...mapped].reverse().find((activity) => activity.status === "running");
  const completedEvents = mapped.filter((activity) => activity.status !== "running");
  const grouped: OwnerActivityGroup[] = [];

  for (const activity of completedEvents) {
    const previous = grouped.at(-1);
    if (previous && previous.kind === activity.kind && previous.status === activity.status && previous.label === activity.label) {
      previous.count = (previous.count ?? 1) + 1;
      previous.completedAt = activity.completedAt;
      continue;
    }
    grouped.push({ ...activity });
  }

  const completedGroupLimit = Math.max(1, Math.min(input.completedGroupLimit ?? 12, 100));
  const completed = grouped.slice(-completedGroupLimit);
  const hasEarlierActivity = Boolean(input.rawTailTruncated) || grouped.length > completedGroupLimit;
  if (input.rawTailTruncated && completed.length) delete completed[0].count;

  return {
    run: ownerSiteAgentRun(run),
    activeSince: chronologicalEvents[0]?.startedAt,
    current: currentEvent ? { ...currentEvent } : undefined,
    completed,
    hasEarlierActivity
  };
}

function ownerActivity(event: SiteAgentRunEvent): OwnerActivityGroup | undefined {
  if (event.status === "cancelled") return undefined;
  if (event.kind === "run" || event.kind === "turn") return undefined;
  if (event.kind === "model_request") {
    if (event.status !== "running") return undefined;
    return ownerActivityGroup(event, "thinking", "Thinking through your request.");
  }
  const mapped = OWNER_ACTIVITY_TOOLS[event.name];
  if (!mapped) return undefined;
  return ownerActivityGroup(event, mapped[0], mapped[1]);
}

function ownerActivityGroup(
  event: SiteAgentRunEvent,
  kind: OwnerActivityGroup["kind"],
  label: string
): OwnerActivityGroup {
  return {
    key: `activity_${createHash("sha256").update(event.id).digest("hex").slice(0, 24)}`,
    kind,
    status: event.status === "cancelled" ? "failed" : event.status,
    label,
    startedAt: event.startedAt,
    completedAt: event.completedAt
  };
}

function ownerRunProgress(run: SiteAgentRun): OwnerRunProgress {
  const retryableByOwner = ownerCanRetrySiteAgentRun(run);
  if (run.status === "cancelled") {
    return {
      label: run.kind === "initial_build" ? "Website build stopped" : "Website update stopped",
      detail: "The active work was stopped. Your published website was not changed."
    };
  }
  if (run.status === "failed" || run.stage === "failed") {
    const savedCheckpoint = Boolean(run.resumeCheckpointId);
    const specific = ({
      authoring_stalled: `The build stopped after the same release check failed ${run.guardrails?.maxConsecutiveIdenticalFailures ?? 3} times without a source change. Change the request or source before trying again; retrying the unchanged request will not help.`,
      cost_limit_exhausted: savedCheckpoint
        ? "The build reached its safety cost limit after Lodesta saved the latest workspace. You can retry without starting the website over."
        : "The build reached its safety cost limit before it completed. Try a narrower request.",
      cost_telemetry_unavailable: "The selected model route stopped reporting reliable cost data, so Lodesta ended the build safely. Wait for Lodesta to repair the model route before retrying.",
      browser_verification_unavailable: savedCheckpoint
        ? "Lodesta saved the completed workspace but could not finish browser verification. Retry to resume from the saved workspace."
        : "Lodesta could not complete browser verification. You can try this request again; the current website was not changed.",
      deadline_exhausted: savedCheckpoint
        ? "The build reached its overall time limit after Lodesta saved the latest workspace. Retry to resume from that workspace."
        : "The build reached its overall time limit before a durable workspace was available. Try the request again.",
      model_tool_schema_invalid: "Lodesta’s authoring tools are temporarily incompatible with the selected model. Your website was not changed. Wait for Lodesta to repair the model route before starting a new request.",
      source_preparation_failed: "Lodesta could not finish collecting the source website. No model authoring was started, and this source-preparation step can be tried again.",
      platform_version_mismatch: "Lodesta’s authoring platform changed while this work was paused. Your website was not changed. Wait for the update to finish, then start a new request instead of retrying this run."
    } as const)[run.failureCode as "authoring_stalled" | "cost_limit_exhausted" | "cost_telemetry_unavailable" | "browser_verification_unavailable" | "deadline_exhausted" | "model_tool_schema_invalid" | "source_preparation_failed" | "platform_version_mismatch"];
    return {
      label: "Website needs attention",
      detail: specific ?? (retryableByOwner
        ? "The work stopped before it finished. You can try this request again."
        : "Lodesta is reviewing an internal problem. You do not need to keep retrying.")
    };
  }
  return ({
    queued: {
      label: "Preparing your website",
      detail: "Your request is ready and waiting for Lodesta to begin."
    },
    retrieving_sources: {
      label: "Gathering business context",
      detail: "Lodesta is collecting the available public source material for this website."
    },
    architecting: {
      label: "Planning your complete website",
      detail: "Lodesta is accounting for the existing site and deciding the complete route structure before design begins."
    },
    authoring: {
      label: "Designing your website",
      detail: run.kind === "initial_build"
        ? "Lodesta is reviewing the available source material and turning your business information into a complete website."
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
    inspecting: {
      label: "Inspecting your website",
      detail: "Lodesta is reviewing the rendered website in a browser and correcting obvious problems."
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
