/**
 * Grammar-bounded composition planning (bespoke quality plan, workstream A).
 *
 * The design-brief model call may propose an ordered composition plan drawn
 * from a fixed intent menu. The compiler builds its full candidate section set
 * deterministically (evidence-gated, exactly as before), then — only when the
 * plan passes this validator — reorders/filters the middle sections to match.
 * Invalid or absent plans fall back to the deterministic default order, so
 * generation never blocks on model output and today's behavior is the floor.
 *
 * Hero and contact are not plannable: hero is always first, contact always
 * last. Archetypes exist only as prompt exemplars, never as runtime code.
 */

export const compositionIntentMenuV3 = [
  "facts",
  "story",
  "services",
  "pricing",
  "process",
  "about",
  "gallery",
  "media",
  "testimonials",
  "faq",
  "cta_band",
  "location"
] as const;

export type CompositionIntentV3 = (typeof compositionIntentMenuV3)[number];

export type CompositionPlanEntryV3 = {
  intent: CompositionIntentV3;
  /** One-line evidence rationale ("media_mosaic after services: 9 usable photos"). */
  why: string;
};

export type CompositionPlanV3 = {
  version: "composition-plan-v1";
  sections: CompositionPlanEntryV3[];
  source: "model";
};

export type PlannableSectionV3 = {
  id: string;
  /** Section template id; used for the no-adjacent-duplicate-template rule. */
  variant: string;
  /** Background identity key ("solid:dark", "gradient:brand", ...) for rhythm rules. */
  backgroundKey?: string;
};

const strongBandBackgrounds = new Set(["solid:dark", "gradient:brand"]);

export function validateCompositionPlanV3(
  plan: CompositionPlanV3,
  builtSections: readonly PlannableSectionV3[],
  context: { hasLocationSection: boolean }
): string[] {
  const violations: string[] = [];
  const entries = plan.sections ?? [];
  const builtById = new Map(builtSections.map((section) => [section.id, section]));

  if (entries.length < 4 || entries.length > 10) {
    violations.push(`Plan must order between 4 and 10 middle sections (got ${entries.length}).`);
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    if (!compositionIntentMenuV3.includes(entry.intent)) {
      violations.push(`Unknown intent "${entry.intent}".`);
      continue;
    }
    if (seen.has(entry.intent)) violations.push(`Intent "${entry.intent}" appears more than once.`);
    seen.add(entry.intent);
    if (!builtById.has(entry.intent)) {
      violations.push(`Intent "${entry.intent}" has no evidence-gated section available for this business.`);
    }
  }

  for (const required of ["services", "faq", "cta_band"] as const) {
    if (builtById.has(required) && !seen.has(required)) {
      violations.push(`Intent "${required}" is required when available.`);
    }
  }
  if (context.hasLocationSection && builtById.has("location") && !seen.has("location")) {
    violations.push('Intent "location" is required for local SEO when first-party location facts exist.');
  }

  const ctaIndex = entries.findIndex((entry) => entry.intent === "cta_band");
  if (ctaIndex !== -1 && ctaIndex < entries.length - 3) {
    violations.push('"cta_band" must sit within the final three planned sections.');
  }

  // No identical template adjacent (the audit-confirmed sibling-rows smell).
  for (let index = 1; index < entries.length; index += 1) {
    const previous = builtById.get(entries[index - 1].intent);
    const current = builtById.get(entries[index].intent);
    if (previous && current && previous.variant === current.variant) {
      violations.push(`Adjacent sections "${entries[index - 1].intent}" and "${entries[index].intent}" share template ${current.variant}.`);
    }
  }

  // Contact (always last, always a strong band) must not stack directly on a
  // strong-band CTA: something must sit between, or the CTA tone must soften.
  const lastEntry = entries[entries.length - 1];
  if (lastEntry?.intent === "cta_band") {
    const cta = builtById.get("cta_band");
    if (cta?.backgroundKey && strongBandBackgrounds.has(cta.backgroundKey)) {
      violations.push('A dark/brand "cta_band" may not sit directly above the contact band; move it earlier or use the paper tone.');
    }
  }

  return violations;
}

/** Reorders sections per an already-validated plan. Hero stays first, contact stays last; unplanned middles drop. */
export function applyCompositionPlanV3<TSection extends { id: string }>(
  sections: readonly TSection[],
  plan: CompositionPlanV3
): { sections: TSection[]; dropped: string[] } {
  const head = sections.filter((section) => section.id === "hero");
  const tail = sections.filter((section) => section.id === "contact");
  const middle = sections.filter((section) => section.id !== "hero" && section.id !== "contact");
  const middleById = new Map(middle.map((section) => [section.id, section]));
  const ordered: TSection[] = [];
  for (const entry of plan.sections) {
    const section = middleById.get(entry.intent);
    if (section) {
      ordered.push(section);
      middleById.delete(entry.intent);
    }
  }
  return {
    sections: [...head, ...ordered, ...tail],
    dropped: [...middleById.keys()]
  };
}
