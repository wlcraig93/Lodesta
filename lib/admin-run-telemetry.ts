import type { SiteAgentRun, SiteAgentRunEvent } from "@/packages/site-contracts";

export const adminRunInspectorViews = ["detail", "log", "outputs", "verification", "run"] as const;
export type AdminRunInspectorView = typeof adminRunInspectorViews[number];

export function isAdminRunInspectorView(value: string | null): value is AdminRunInspectorView {
  return adminRunInspectorViews.includes(value as AdminRunInspectorView);
}

export function resolveAdminRunEvent(
  events: SiteAgentRunEvent[],
  runStatus: SiteAgentRun["status"],
  requestedEventId: string | null
) {
  const requested = events.find((event) => event.id === requestedEventId);
  if (requested) return requested;
  if (runStatus === "failed") return events.find((event) => event.status === "failed") ?? events[0];
  return events[0];
}

export function mergeAdminRunEvents(current: SiteAgentRunEvent[], incoming: SiteAgentRunEvent[]) {
  const merged = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) merged.set(event.id, event);
  return [...merged.values()].sort((left, right) => left.sequence - right.sequence);
}

export function isMeteredModelEvent(event: SiteAgentRunEvent) {
  return event.kind === "model_request" || (event.name === "create_image" && event.costSource !== undefined);
}

export function adminFailureGuidance(code: string | undefined) {
  if (!code) return "None";
  return ({
    authoring_stalled: "Inspect the repeated release diagnostic, change the workspace source, then enqueue a new run.",
    cost_limit_exhausted: "Review per-request costs and the saved checkpoint. Resume only after confirming the configured fuse is appropriate.",
    cost_telemetry_unavailable: "Restore provider billing telemetry or local catalog pricing before retrying this model route.",
    browser_verification_unavailable: "Inspect the retained browser diagnostic, restore the canonical accessibility verifier, then retry the owner request.",
    deadline_exhausted: "Resume from the saved checkpoint or split the request; investigate repeated deadline exhaustion before raising the deadline.",
    platform_version_mismatch: "Keep authoring in maintenance, complete the coordinated controller and sandbox release, verify deep health, then resolve the operator item."
  } as Record<string, string>)[code] ?? "No operator recovery guidance is recorded for this failure.";
}
