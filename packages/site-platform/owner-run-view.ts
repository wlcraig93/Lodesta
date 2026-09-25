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
  | "changedRoutes" | "sharedStylesChanged"
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
    ...(run.status === "succeeded" && run.kind !== "initial_build" && run.changedRoutes ? { changedRoutes: run.changedRoutes } : {}),
    ...(run.status === "succeeded" && run.sharedStylesChanged ? { sharedStylesChanged: true } : {}),
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
    // Plain language: what happened, whether the live site changed, and what to do next.
    const specific = ({
      authoring_stalled: "Lodesta got stuck on the same problem and stopped. Your live website hasn't changed. Try rewording the request; repeating it unchanged won't help.",
      cost_limit_exhausted: savedCheckpoint
        ? "This took more work than expected, so Lodesta paused and saved its progress. Your live website hasn't changed. Try again to pick up where it left off."
        : "This took more work than expected, so Lodesta stopped. Your live website hasn't changed. Try a smaller change.",
      cost_telemetry_unavailable: "Lodesta hit a problem on its side and stopped safely. Your live website hasn't changed. We're fixing it; please try again later.",
      browser_verification_unavailable: savedCheckpoint
        ? "Lodesta finished the work but couldn't run its final checks. Your live website hasn't changed. Try again to pick up where it left off."
        : "Lodesta couldn't run its final checks. Your live website hasn't changed. Try again.",
      deadline_exhausted: savedCheckpoint
        ? "This took too long, so Lodesta paused and saved its progress. Your live website hasn't changed. Try again to pick up where it left off."
        : "This took too long and was stopped. Your live website hasn't changed. Try again.",
      model_tool_schema_invalid: "Lodesta hit a problem on its side. Your live website hasn't changed. We're fixing it; please try again later.",
      source_preparation_failed: "Lodesta couldn't read your current website. Nothing was changed. Try again.",
      platform_version_mismatch: "Lodesta was updated while this was paused. Your live website hasn't changed. Ask for the change again in the chat."
    } as const)[run.failureCode as "authoring_stalled" | "cost_limit_exhausted" | "cost_telemetry_unavailable" | "browser_verification_unavailable" | "deadline_exhausted" | "model_tool_schema_invalid" | "source_preparation_failed" | "platform_version_mismatch"];
    return {
      label: run.kind === "initial_build" ? "Website build didn't finish" : "Website change didn't finish",
      detail: specific ?? (retryableByOwner
        ? "This stopped before it finished. Your live website hasn't changed. You can try again."
        : "Lodesta hit a problem on its side. Your live website hasn't changed. We'll look into it, so there's no need to keep retrying.")
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
