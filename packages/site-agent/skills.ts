export type ManagerTaskKind = "initial_build" | "edit" | "rebase";

export type ManagerTaskSkill = {
  id: "website-authoring";
  version: "website-authoring-v1";
  objective: string;
  knowledge: string[];
};

const universalKnowledge = [
  "Honor the owner's exact requested outcome before considering optional improvements.",
  "Use only eligible facts, assets, forms, links, and capabilities from the public evidence packet.",
  "Keep claims concrete and evidence-bound; ordinary tone and marketing language do not require artificial claim declarations.",
  "Local-business sites should establish the specific business quickly, make navigation usable on small screens, and give the primary customer action a clear path without repeating it everywhere.",
  "Use business-specific facts, services, location, media, and brand constraints to make visual and content decisions; do not infer a fixed section order or layout recipe from this guidance.",
  "Use semantic, keyboard-accessible markup, readable type, visible focus, sufficient contrast, and touch-friendly controls.",
  "Preserve unrelated working content during edits and update shared dependencies only when the request requires it.",
  "Treat verification blockers as release-boundary facts and visual suggestions as advisory."
];

export function taskSkillFor(kind: ManagerTaskKind): ManagerTaskSkill {
  const objective = kind === "initial_build"
    ? "Create the complete customer website from the supplied business evidence and site intent."
    : kind === "rebase"
      ? "Reconcile the current website with the supplied canonical business evidence while preserving its presentation."
      : "Apply the owner's requested website change precisely while preserving unrelated working behavior.";
  return { id: "website-authoring", version: "website-authoring-v1", objective, knowledge: [...universalKnowledge] };
}
