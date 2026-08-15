import { sha256, stableJson } from "@/packages/business-data";

export type ManagerTaskKind = "initial_build" | "edit" | "rebase";

const objectives = {
  initial_build: "Create the complete customer website from the supplied business evidence and site intent.",
  edit: "Apply the owner's requested website change precisely while preserving unrelated working behavior.",
  rebase: "Reconcile the current website with the supplied canonical business evidence while preserving its presentation."
} satisfies Record<ManagerTaskKind, string>;

const canonicalKnowledge = [
  "Implement every explicit route and disposition in src/approved-architecture.ts. src/approved-source-index.ts maps approved routes to exact retained files and includes short evidence previews; use them for distinctive customer answers, then inspect a raw source file only when an answer remains unclear. Never map extracted paragraphs into render-time copy or metadata. Every live object in siteDefinition.routes explicitly declares its own distinct truthful title and description derived from that route's customer job and retained answer. Final copy speaks directly to the customer and never mentions pages, templates, site organization, maps, mazes, research, evidence, sources, retained or public materials, or the building process.",
  "Owner-authoritative facts outrank retained observations. Preserve exact eligible identity, phone, email, address, hours, forms, and customer-portal destinations. Never invent or paraphrase an unsupported service, location, person, credential, award, rating, price, offer, guarantee, response time, availability, result, safety or environmental quality, or service cadence; omit gated source marketing unless exact publicFacts support it. Do not characterize an address as a main shop, headquarters, flagship, or only location unless that exact role is supported.",
  "Judge supplied assets by visible pixels, never their labels alone. Use the exact official logo at its intrinsic proportions on a compatible deliberate surface. Prefer an authentic business-specific branded person, vehicle, premises, or work scene. When none is strong enough but a polished retained photograph visibly depicts the core problem, service, or environment, a homepage made only from the logo, type, CSS shapes, or decorative symbols is below the launch target: use the strongest relevant photograph once in a high-salience role with a deliberate responsive crop. Omit misleading, weak, unrelated, or generic filler; browse ranked retained image resources only when a stronger route-relevant asset may exist. Do not repeat scarce photography across unrelated routes. Never invent a competing mark, monogram, badge, slogan poster, pseudo-map, coverage radius, decorative diagram, or business imagery. The entire exact logo mark must remain visibly recognizable at desktop and phone sizes: never enlarge internal logo artwork by translating it outside an overflow-hidden wrapper or clipping any part of its canvas; instead use a compatible surface and enough bounded height.",
  "Choose one named design grammar that fits the business and execute its palette, typography, crop, spacing, and rhythm coherently. Give each primary route a distinct first-viewport job: the homepage orients and converts; the service hub exposes a grouped complete inventory; service details answer the exact concern with relevant evidence; locations expose supported communities; About supplies business context; Contact begins the contact path; FAQ and guides expose their useful questions or content. By the end of the first natural viewport, show the first route-specific useful unit or action; do not let an oversized title-only opening or decorative empty field postpone it. Shared structure may repeat, but visible copy and composition remain route-specific. Edit long service inventories into a scannable hierarchy with grouped compact rows, links, or categories; never assign every service equal card weight or show a long uniform wall of cards.",
  "Keep conversion clear and proportionate. Make every live route reachable through concise navigation or an explicit hub. Present supported service area as readable grouped place names and, when useful, a real managed address or directions block; never imply unsupported precision through a map-like graphic, radius, circle, local-focus badge, or coverage visualization. When canonical locality, address, or service-area evidence exists, render one concise honest homepage cue through the supplied fact binding rather than only unbound prose; do not substitute a pseudo-map or radius graphic.",
  "Meaningful copy and form text are at least 16px, utility text at least 12px, and essential controls are at least 44px. Forms stack on phones and dense groups recompose. Keep the phone header in normal document flow unless the owner requests sticky or fixed navigation. Use native semantic HTML and authored CSS for navigation presentation and interaction; authored client JavaScript is unavailable. Choose the native mechanism, breakpoint, geometry, grouping, and visual treatment for this site. At every breakpoint, keep every primary destination declared by the architecture, customer portal, and conversion path reachable; do not make service destinations mobile-only. The opened phone state must be opaque, legible, keyboard-operable, viewport-contained, and hit-testable; Escape and closing must leave focus and the page usable. Inspect it opened before finishing.",
  "Inspect the supplied representative route set when pixels can change your judgment: omit route from inspect_site to cover that set; route '/' proves only the homepage. Correct reported contrast at the nearest affected selector after reading its full cascade; avoid broad late overrides or comma groups that span light and dark surfaces. Treat internal-provenance copy and evidence-free identity devices as unfinished customer output, while avoiding unrelated taste churn.",
  "Preserve the supplied scaffold contract: siteDefinition is an object whose routes field remains an array of route objects with rendered JSX elements; every emitted route object has an explicit string path, title, description, and rendered element, including objects returned by map helpers. CSS beneath src/ is automatic and is never imported from TypeScript; each apply_patch path appears at most once. Bind repeated route content by an explicit path or stable key rather than a positional array index. The source policy rejects dynamic object[key] access; use Map.get(key), a switch, or explicit conditions for route-keyed content. SafeLink already renders its anchor; use it directly with className and never wrap it in <a>. Before the first rendered inspection, review the complete import list and siteDefinition.routes declaration together."
];

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

export const websiteAuthoringSkillIdentity = `website-authoring@${sha256(stableJson({
  id: "website-authoring",
  objectives,
  knowledge: canonicalKnowledge
}))}` as `website-authoring@sha256:${string}`;

export function canonicalTaskSkillFor(kind: ManagerTaskKind): ManagerTaskSkill {
  return {
    id: "website-authoring",
    identity: websiteAuthoringSkillIdentity,
    objective: objectives[kind],
    knowledge: [...canonicalKnowledge],
    supportingSkills: []
  };
}

export function taskSkillFor(kind: ManagerTaskKind): ManagerTaskSkill {
  return canonicalTaskSkillFor(kind);
}
