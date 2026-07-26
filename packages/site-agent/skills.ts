export type ManagerTaskKind = "initial_build" | "edit" | "rebase";

export type ManagerTaskSkill = {
  id: "website-authoring";
  identity: "website-authoring@sha256:12c3102273599ae4a9688cb8419c59412c7e63e6bcc6ed109194361f213fabb4";
  objective: string;
  knowledge: string[];
};

const universalKnowledge = [
  "Honor the owner's exact requested outcome before considering optional improvements.",
  "Use only eligible facts, assets, forms, links, and capabilities from the site authoring brief.",
  "Treat the brief's services as the source-backed service authority: preserve the supplied business wording, use its evidence blocks for concrete detail, and omit claims where the brief identifies an evidence gap.",
  "Give each retained dedicated service route enough distinct, useful explanation to justify the route; do not create thin keyword variants or repeat the same generic paragraph across services.",
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
  return {
    id: "website-authoring",
    identity: "website-authoring@sha256:12c3102273599ae4a9688cb8419c59412c7e63e6bcc6ed109194361f213fabb4",
    objective,
    knowledge: [...universalKnowledge]
  };
}
