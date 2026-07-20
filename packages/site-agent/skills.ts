export type ManagerTaskKind = "initial_build" | "focused_edit" | "page_edit" | "qa_repair" | "seo_aeo_improvement" | "rebase";

export type ManagerTaskSkillV1 = {
  id: string;
  version: string;
  objective: string;
  constraints: string[];
};

const taskSkills: Record<ManagerTaskKind, ManagerTaskSkillV1> = {
  initial_build: {
    id: "initial-construction",
    version: "initial-construction-v1",
    objective: "Create a complete, coherent website from the immutable public input.",
    constraints: [
      "Define a business-specific visual thesis and content architecture before authoring routes.",
      "Include every required route and make the primary conversion path usable from every route.",
      "Use only eligible facts, assets, forms, links, and capabilities from the public input."
    ]
  },
  focused_edit: {
    id: "focused-edit",
    version: "focused-edit-v1",
    objective: "Apply the requested local change while preserving the rest of the site's coherent state.",
    constraints: [
      "Treat the selected route and selector as scope evidence, not permission to ignore shared dependencies.",
      "Do not restyle unrelated routes, remove content, or change conversion behavior unless required by the request.",
      "Return the complete source snapshot with the requested change visibly present."
    ]
  },
  page_edit: {
    id: "page-architecture",
    version: "page-architecture-v1",
    objective: "Add or materially revise page structure while preserving whole-site navigation and visual coherence.",
    constraints: [
      "Update navigation and cross-links when route structure changes.",
      "Avoid repetitive service-page shells; give the page a task-specific hierarchy grounded in eligible facts.",
      "Preserve unaffected routes and platform capability bindings."
    ]
  },
  qa_repair: {
    id: "qa-repair",
    version: "qa-repair-v1",
    objective: "Repair the supplied objective or critic findings without broad redesign.",
    constraints: [
      "Address every supplied finding directly and preserve already-valid routes, facts, and capabilities.",
      "Do not weaken validation, remove required content, or hide failures visually.",
      "Prefer robust responsive CSS and semantic markup over case-specific exceptions."
    ]
  },
  seo_aeo_improvement: {
    id: "seo-aeo-improvement",
    version: "seo-aeo-improvement-v1",
    objective: "Improve discoverability and answer quality without fabricating facts or degrading the visual experience.",
    constraints: [
      "Use descriptive titles, headings, internal links, and concise direct answers from eligible facts.",
      "Do not create doorway pages, keyword repetition, unsupported local claims, or hidden text.",
      "Preserve the platform-owned structured-data and metadata boundary."
    ]
  },
  rebase: {
    id: "canonical-rebase",
    version: "canonical-rebase-v1",
    objective: "Reconcile the existing workspace with a newer immutable public input.",
    constraints: [
      "Replace stale canonical values everywhere they appear and remove claims no longer supported by the input.",
      "Preserve presentation and route structure unless the authority change makes them invalid.",
      "Do not reintroduce facts, assets, links, forms, or offerings absent from the new input."
    ]
  }
};

export function taskSkillFor(kind: ManagerTaskKind): ManagerTaskSkillV1 {
  return structuredClone(taskSkills[kind]);
}
