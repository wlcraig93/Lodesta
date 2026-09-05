import { sha256, stableJson } from "@/packages/business-data";

export type ManagerTaskKind = "initial_build" | "edit" | "rebase";

const objectives = {
  initial_build: "Create the complete customer website from the supplied business evidence and site intent. Use specific customer copy and route metadata, carry the strongest mapped first-party proof into the relevant conversion path, deliberately judge the retained media, and render the exact supplied Google aggregate-rating observation as complementary homepage proof when it is present.",
  edit: "Apply the owner's requested website change precisely while preserving unrelated working behavior.",
  rebase: "Reconcile the current website with the supplied canonical business evidence while preserving its presentation."
} satisfies Record<ManagerTaskKind, string>;

const sharedKnowledge = [
  "Owner-authoritative facts outrank retained observations. Preserve exact eligible identity, phone, email, address, hours, forms, assets, and customer-portal destinations. Never invent or paraphrase an unsupported service, location, person, credential, award, rating, price, offer, guarantee, response time, availability, result, safety or environmental quality, service cadence, field ID, provider, or submission destination. A mapped retained first-party page may support ordinary biography and qualitative positioning when the source clearly and consistently attributes it to the business; this never authorizes a professional or regulated credential, award, rating, price, offer, guarantee, response time, availability, outcome, safety or environmental performance claim, or service cadence without exact publicFacts support, except for the narrow captured Google-rating policy in the initial-build guidance. Do not characterize an address as a main shop, headquarters, flagship, or only location unless that exact role is supported.",
  "Preserve the supplied scaffold and capability contract. siteDefinition.routes remains an array of route objects with explicit string path, truthful title, description, and rendered JSX element. CSS beneath src/ is automatic and is never imported from TypeScript. Keep authored TSX and CSS readable, structurally formatted, and organized rather than minified; specifically, keep CSS readable and organized rather than minified, do not collapse components, route data, or long content bodies into enormous single lines, place component rules where they can be edited canonically, and do not accumulate appended override layers during repair. Keep property access statically named; use Map.get, a switch, or explicit conditions for route-keyed content. SafeLink already renders its anchor and must not be wrapped in <a>. Runtime capabilities own navigation state and managed form submission; authored source owns trigger artwork and presentation. Render every nonempty owner-authoritative destination from src/required-destinations.tsx in a reachable location."
] as const;

const initialBuildKnowledge = [
  "Routes and evidence. Implement approvedSourceIndex.liveRoutePaths as the exact internal-route set and approvedSourceIndex.primaryNavigation as the primary navigation. The release service owns redirects and retirements; do not add, remove, merge, or redirect routes during authoring. Historical sourcePath values are evidence, not destinations: use the mapped approvedLinkPath. Read the exact files in approvedSourceIndex.routeSourceFiles when their previews lack the material needed for a complete page; previews locate evidence, not limit content. Never guess source-site paths or map raw extracted paragraphs into render-time copy.",
  "Complete source-sensitive documents. For privacy, terms, cookie, legal, and accessibility routes, read approvedSourceIndex.sourceSensitiveDocuments and preserve the complete substantive source body in readable authored source. Keep provisions, numerals, durations, and meaning exact; omit shared site-navigation boilerplate. Preserve tables with semantic headers and a responsive, keyboard-reachable scroll wrapper. This exact legal content is required, not prohibited raw-data mapping. Never obscure customer-visible text to evade verification or append duplicate provisions to increase similarity.",
  "Write for the customer's decision. Give each route a clear service or subject, a concrete answer to its visitor's question, relevant supported detail and proof, and a truthful action. Read beyond the preview when the source holds useful explanations, projects, customer feedback, or article detail. A substantive retained guide needs its explanatory arc, not a teaser. Share editorial shells, but make each body useful on its own. General guidance about observable problems, choices, or preparation can fill genuine gaps without implying unverified business methods, capabilities, or promises. If changing only a service name would make the copy fit a sibling route or competitor, use the mapped evidence to make the answer specific.",
  "Customer language. Use concrete nouns, active verbs, informative headings, and direct actions such as Call or Request an estimate. Each section should answer its heading and reduce a real uncertainty; remove catch-all paragraphs and padding. Keep research, provenance, route-planning, and missing-capability explanations out of published copy. Do not substitute an abstract slogan for the service or explain that content is based on sources. Write a distinct truthful title and description for every route, never one global fallback description. Copy should sound like this business speaking to its customers, not a website builder describing its work.",
  "Proof and reviews. Put the strongest relevant supported evidence near the decision it helps, including on the homepage. Use the retained projects, people, and first-party feedback when they substantiate approved proof routes. Customer quotations published directly on the first-party website require exact excerpts with their exact attribution; do not paraphrase quotations, split one testimonial into multiple customers, or style new marketing copy as customer testimony. Do not copy individual review text from Google, Yelp, Facebook, or embedded third-party review surfaces. With no supported proof, use the honest available action rather than inventing evidence or narrating its absence.",
  "Google aggregate rating. When provisionalObservations.googleAggregateRating is present, render its displayText exactly on the initial homepage, including when first-party testimonials also exist. Do not infer, round, refresh, or fabricate a rating. When profileUrl is supplied, pair the rating with Read reviews on Google using an ordinary anchor to that exact URL, target=\"_blank\" and rel=\"noopener noreferrer\". Do not pass this URL to SafeLink or invent a managed link ID. With no profileUrl, invent no destination; with no observation, omit the rating. Other external destinations remain restricted to managedCapabilities.links. Public research is available for a concrete unresolved current-fact need, not for third-party review prose.",
  "Business identity and imagery. Inspect promising retained media and its intrinsic dimensions, not filenames alone. Use authentic relevant work, people, premises, or service imagery where it strengthens the page; distribute useful distinct images across relevant routes without an image quota. Choose an intentional text-led composition when the available media is weak. A small raster is thumbnail evidence, not a hero: keep its rendered role within its real resolution or find a higher-resolution retained resource. Preserve the exact official logo, proportions, and recognizable artwork. Render one identity per header state; use BusinessName beside an emblem or unreadable wordmark, but do not duplicate an already readable full name. With no credible logo, use BusinessName as ordinary typography. Invent no marks, initials devices, proof badges, business imagery, or geographic precision. Preserve or fully exclude baked-in lettering when cropping and keep new copy off it. Use loading=\"eager\" and fetchPriority=\"high\" for first-viewport imagery; keep deeper images lazy.",
  "One coherent visual system, content-led pages. Choose typography, palette, spacing, surfaces, and image treatments suited to the business. Share the header, footer, tokens and primitives, not task-specific assumptions: let the customer purpose shape each page's composition, supporting copy and closing action. Work-led, comparison-led, urgent-help, and contact pages should not all become the same hero/card-grid/process/banner with different nouns. Genuine differences require different hierarchy or decision support, not gratuitous layout variation. The first viewport should explain the service or subject and expose useful content or the primary action without an oversized headline crowding it out. Keep collection layouts deliberate and local context readable; decorative numbers and diagrams are not proof.",
  "Responsive conversion. Recompose for phone and tablet; reflow sidebars when they squeeze reading or actions, and keep real imagery legible. Give a form its purpose and essential safety context first, not a backlog of secondary reference details. Give each contact method one clear role rather than repeating adjacent versions of the same phone number. Preserve geographic qualifiers and distinguish emergency availability from ordinary hours. A control must perform its promised action; use a truthful approved link or static content when an interactive capability is unavailable.",
  "Navigation and forms. For a blank initial build use NavigationDisclosure behavior=\"modal\" for phone navigation unless the owner requests otherwise, plus a separate semantic desktop nav; breakpoint CSS must show exactly one pattern. Author a recognizable three-bar closed trigger and unmistakable close state using aria-expanded. Give closed bars distinct positions; for an X, center and rotate the outer bars oppositely and hide the middle. Runtime owns state, focus, and containment; authored source owns artwork and presentation. Keep every required destination reachable. Compose custom LeadForm layouts with LeadField label and control class props, LeadSubmit, and one LeadFormStatus; render each configured field exactly once. Use visible labels, full-column controls, appropriate wider-screen grouping, and phone stacking. Field schema, validation, revision, and inbox submission remain managed.",
  "Accessible, maintainable implementation. Give every live route one clear H1, semantic landmarks, logical headings, and a keyboard-visible skip link to main. Set body and form text to at least 16px, utility text at least 12px, and essential controls at least 48px. Define contrasting text colors per surface and visible focus styling. Use supported text and accessible inline SVG, not authored emoji; do not silently remove owner-authoritative text. Organize source-rich sites into readable focused route, content, legal, and shared-shell modules from the first write. Edit component rules in place and remove repair-created duplicate declarations; do not accumulate broad overrides.",
  "Review and finish. Use inspect_site with route: null for the architecture-selected representative set; route: '/' inspects only home. The default sample is a starting point, not whole-site approval. Choose additional routes when distinct content or composition leaves a material uncertainty. Judge the supplied pixels alongside copy and retained evidence, including opened phone navigation and the complete form. Correct errors and critical or serious accessibility failures. Use warnings about contrast, text, targets, metadata, clipping, or repeated route content to find concrete causes, repairing shared causes at their canonical declaration. Advisory IA similarity is evidence, not a score: a shared structure serving the same customer job may be appropriate. Do not remove an approved route to clear an advisory or edit merely to force warnings to zero. Reinspect affected routes when changed pixels remain uncertain. Finish when the complete site has no material factual, functional, accessibility, copy, or visual defect; finish performs full release verification."
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
