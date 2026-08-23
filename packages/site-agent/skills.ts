import { sha256, stableJson } from "@/packages/business-data";

export type ManagerTaskKind = "initial_build" | "edit" | "rebase";

const objectives = {
  initial_build: "Create the complete customer website from the supplied business evidence and site intent.",
  edit: "Apply the owner's requested website change precisely while preserving unrelated working behavior.",
  rebase: "Reconcile the current website with the supplied canonical business evidence while preserving its presentation."
} satisfies Record<ManagerTaskKind, string>;

const sharedKnowledge = [
  "Owner-authoritative facts outrank retained observations. Preserve exact eligible identity, phone, email, address, hours, forms, assets, and customer-portal destinations. Never invent or paraphrase an unsupported service, location, person, credential, award, rating, price, offer, guarantee, response time, availability, result, safety or environmental quality, service cadence, field ID, provider, or submission destination; omit gated source marketing unless exact publicFacts support it. Do not characterize an address as a main shop, headquarters, flagship, or only location unless that exact role is supported.",
  "Preserve the supplied scaffold and capability contract. siteDefinition.routes remains an array of route objects with explicit string path, truthful title, description, and rendered JSX element. CSS beneath src/ is automatic and is never imported from TypeScript. Keep property access statically named; use Map.get, a switch, or explicit conditions for route-keyed content. SafeLink already renders its anchor and must not be wrapped in <a>. Runtime capabilities own navigation state and managed form submission; authored source owns trigger artwork and presentation. Render every nonempty owner-authoritative destination from src/required-destinations.tsx in a reachable location."
] as const;

const initialBuildKnowledge = [
  "Implement every explicit route and disposition in src/approved-architecture.ts. src/approved-source-index.ts maps approved routes to exact retained files and includes short evidence previews; use them for distinctive customer answers, then inspect a raw source file only when an answer remains unclear. Never map extracted paragraphs into render-time copy or metadata. Render numerical or transactional claims such as prices only when the exact value is available through a supplied public-fact binding; otherwise preserve the qualitative customer answer and approved destination without inventing an unbound marker. Every live route has a distinct customer job and retained answer. Final copy speaks directly to the customer and never mentions pages, templates, site organization, maps, mazes, research, evidence, sources, retained or public materials, or the building process.",
  "Judge supplied assets by visible pixels, never their labels alone. Use the exact official logo at its intrinsic proportions on a compatible deliberate surface. Prefer an authentic business-specific branded person, vehicle, premises, or work scene. When none is strong enough but a polished retained photograph visibly depicts the core problem, service, or environment, use the strongest relevant photograph once in a high-salience role with a deliberate responsive crop. Omit misleading, weak, unrelated, or generic filler. Never invent a competing mark, monogram, badge, slogan poster, pseudo-map, coverage radius, decorative diagram, or business imagery. Keep the entire exact logo visibly recognizable at desktop and phone sizes without clipping or translating its artwork outside a bounded wrapper.",
  "Choose one named design grammar that fits the business and execute its palette, typography, crop, spacing, and rhythm coherently. Give each primary route a distinct first-viewport job and show its first useful unit or action by the end of the first natural viewport. Shared structure may repeat, but visible copy and composition remain route-specific. Edit long service inventories into a scannable hierarchy rather than a uniform wall of equal cards.",
  "Use only portable text supported by the trusted font catalog. Do not put emoji in agent-authored copy or controls; author decorative icons as accessible inline SVG. Never silently remove owner-authoritative emoji: leave it unresolved until the owner approves ordinary text or Lodesta adds explicit portable coverage.",
  "Keep conversion clear and proportionate. Make every live route reachable through concise navigation or an explicit hub. Present supported service area as readable grouped place names and, when useful, a real managed address or directions block; never imply unsupported precision through a map-like graphic, radius, circle, badge, or coverage visualization. When canonical locality, address, or service-area evidence exists, render one concise honest homepage cue through the supplied fact binding.",
  "On a blank initial build, use managed NavigationDisclosure behavior=\"modal\" for mobile navigation unless the owner explicitly requests another pattern. Default to a conventional three-bar closed trigger and a distinct close state unless the business design justifies an equally familiar alternative. Keep the closed-state strokes visibly separated at rendered size; never collapse multiple bars onto one coordinate or reuse an indistinguishable single stroke. Author both states explicitly and inspect them when their rendered clarity is uncertain. Make essential controls and destinations at least 48px in the authored design. The modal capability owns state and viewport containment; the site owns artwork, breakpoints, spacing, inner composition, and motion. Keep every required destination reachable, and repair the selected managed pattern rather than abandoning it merely to avoid a repair finding. Use visible form labels, at least 16px form text, and a phone-stacked managed form layout.",
  "Inspect the supplied representative route set when pixels can change your judgment, including the opened phone navigation when its appearance is materially uncertain. Omit route from inspect_site to cover the representative set; route '/' proves only the homepage. Correct reported contrast and target-size findings at the existing component-scoped declaration after reading its full cascade; never add a broad element or attribute selector, or an appended repair layer, that overrides unrelated components or responsive visibility. Treat internal-provenance copy and evidence-free identity devices as unfinished customer output, while avoiding unrelated taste churn."
] as const;

const editKnowledge = [
  "Preserve every existing workspace source file unconditionally and change only what the owner requested. Treat the supplied route and selected element as the primary scope, read only the files needed, preserve unrelated design, content, navigation, forms, and working behavior, and never restore an initial-build default merely because Lodesta would start a blank site differently.",
  "Prefer line-targeted edits. Inspect only when a concrete visual uncertainty could materially affect the requested result; use the supplied selection outline when relevant. After a successful targeted edit, call finish directly rather than polishing unrelated areas. If the requested edit touches navigation or forms, preserve required destinations, schema-owned fields, managed submission, and the owner's chosen presentation."
] as const;

const rebaseKnowledge = [
  "Reconcile deterministic control-plane changes into the current website while preserving every existing workspace source file and the site's presentation. Update only the exact owner-authoritative facts, forms, assets, links, or destinations that changed. Preserve routes, composition, copy, and styling unless the new authority makes a specific existing value invalid. Never apply blank-build design defaults or reinterpret a rebase as a redesign.",
  "Keep every nonempty required destination reachable and every configured managed-form field represented exactly once. Inspect only when the authority change creates a concrete visual uncertainty; otherwise finish after the deterministic reconciliation succeeds without unrelated churn."
] as const;

const knowledgeByKind = {
  initial_build: initialBuildKnowledge,
  edit: editKnowledge,
  rebase: rebaseKnowledge
} satisfies Record<ManagerTaskKind, readonly string[]>;

export type ManagerTaskSkill = {
  id: "website-authoring";
  identity: `website-authoring@sha256:${string}`;
  objective: string;
  knowledge: string[];
  supportingSkills: Array<{
    id: string;
    identity: string;
    objective: string;
    knowledge: string[];
  }>;
};

function canonicalKnowledgeFor(kind: ManagerTaskKind) {
  return [...sharedKnowledge, ...knowledgeByKind[kind]];
}

export function websiteAuthoringSkillIdentityFor(kind: ManagerTaskKind) {
  const knowledge = canonicalKnowledgeFor(kind);
  return `website-authoring@${sha256(stableJson({
    id: "website-authoring",
    kind,
    objective: objectives[kind],
    knowledge
  }))}` as `website-authoring@sha256:${string}`;
}

export function canonicalTaskSkillFor(kind: ManagerTaskKind): ManagerTaskSkill {
  return {
    id: "website-authoring",
    identity: websiteAuthoringSkillIdentityFor(kind),
    objective: objectives[kind],
    knowledge: canonicalKnowledgeFor(kind),
    supportingSkills: []
  };
}

export function taskSkillFor(kind: ManagerTaskKind): ManagerTaskSkill {
  return canonicalTaskSkillFor(kind);
}
