import type {
  BusinessFactKind,
  ConversionGoal,
  GenerationPlanV2,
  GenerationPlanV2Section,
  LayoutSectionKind,
  SiteArtDirection,
  SiteDirectorClaimCategory,
  SiteDirectorCopyPolicy,
  SiteDirectorSectionDecision
} from "./models";

export const siteDirectorContractVersion = "site-director-v1" as const;
export const siteDirectorPromptVersion = "site-director-prompt-v1" as const;

const sensitiveClaimCategories: SiteDirectorClaimCategory[] = [
  "credentials",
  "insurance",
  "pricing",
  "warranty",
  "emergency",
  "regulated"
];

export function createSiteDirectorMetadata(input: {
  planningMode: GenerationPlanV2["director"]["planningMode"];
  model?: string;
  deterministicPasses?: number;
  aiRetries?: number;
}): GenerationPlanV2["director"] {
  return {
    contractVersion: siteDirectorContractVersion,
    promptVersion: siteDirectorPromptVersion,
    planningMode: input.planningMode,
    model: input.model,
    structuralRules: [
      "Choose only registered layout presets and section kinds.",
      "Attach every factual claim to fact ids from the business fact graph.",
      "Omit optional sections when required safe facts are missing.",
      "Never invent credentials, insurance, pricing, warranties, emergency availability, regulated outcomes, reviews, awards, or years in business.",
      "Prefer fewer strong sections over visible placeholders or internal review language.",
      "Generated copy must pass claim verification before the candidate can be marked ready."
    ],
    repairContract: {
      deterministicPasses: input.deterministicPasses ?? 1,
      aiRetries: input.aiRetries ?? 1
    },
    rejectionContract: {
      unsupportedSection: "omit_or_block_before_ready",
      unsupportedClaim: "block_ready_until_removed_or_verified",
      structuralHallucination: "reject_section_not_backed_by_fact_contract"
    }
  };
}

export function siteDirectorIntentForSection(input: {
  kind: LayoutSectionKind;
  primaryGoal: ConversionGoal;
  artDirection: SiteArtDirection;
}) {
  if (input.kind === "hero") return `Establish the business, primary service fit, and ${goalLabel(input.primaryGoal)} path in the first viewport.`;
  if (input.kind === "services") return "Make the concrete services scannable without adding unsupported details.";
  if (input.kind === "contact") return `Keep the ${goalLabel(input.primaryGoal)} action visible and low friction.`;
  if (input.kind === "proof") return "Use only source-backed public proof signals; otherwise keep trust copy generic and action-focused.";
  if (input.kind === "gallery") return "Use safe visual assets to create service context without implying real project outcomes.";
  if (input.kind === "before_after") return "Explain the type of outcome customers can ask about without inventing before/after claims.";
  if (input.kind === "faq") return "Answer conversion questions with source-backed facts and clear uncertainty boundaries.";
  if (input.kind === "map") return "Show location or service-area context only when address or area facts are available.";
  if (input.kind === "team") return "Introduce people only when team facts exist; otherwise omit or keep role-level copy generic.";
  if (input.kind === "cta") return `Repeat the ${goalLabel(input.primaryGoal)} path after visitors have service context.`;
  if (input.kind === "press") return "Surface only public links already present in the fact graph.";
  return `Support the ${input.artDirection} direction with source-grounded content.`;
}

export function siteDirectorCopyPolicyForSection(input: {
  kind: LayoutSectionKind;
  requiredFactKinds: BusinessFactKind[];
  optionalFactKinds: BusinessFactKind[];
}): SiteDirectorCopyPolicy {
  const kinds = [...input.requiredFactKinds, ...input.optionalFactKinds];
  const allowed = new Set<SiteDirectorClaimCategory>(["business_identity", "service", "contact"]);
  for (const kind of kinds) {
    for (const category of claimCategoriesForFactKind(kind)) allowed.add(category);
  }
  const forbidden = sensitiveClaimCategories.filter((category) => !allowed.has(category));
  return {
    grounding: "fact_ids_only",
    allowedClaimCategories: Array.from(allowed),
    forbiddenClaimCategories: forbidden,
    missingFactBehavior: missingFactBehaviorForSection(input.kind)
  };
}

export function claimCategoriesForFactKind(kind: BusinessFactKind): SiteDirectorClaimCategory[] {
  switch (kind) {
    case "name":
    case "category":
    case "description":
      return ["business_identity"];
    case "service":
      return ["service"];
    case "service_area":
    case "address":
    case "geo":
      return ["location"];
    case "phone":
    case "email":
    case "booking_link":
    case "ordering_link":
    case "social_link":
    case "press_link":
      return ["contact"];
    case "hours":
      return ["hours"];
    case "review_summary":
      return ["reviews"];
    case "photo":
    case "logo":
    case "proof_signal":
      return ["service"];
    case "team_member":
      return ["business_identity"];
  }
}

export type SiteDirectorDecisionInput = {
  pageId: string;
  sectionId: string;
  action: SiteDirectorSectionDecision["action"];
  priority: number;
  rationale: string;
  factIds: string[];
  allowedClaimCategories: SiteDirectorClaimCategory[];
  headlineBrief?: string;
  bodyBrief?: string;
  riskNotes: string[];
};

export type SiteDirectorDecisionIssue = {
  id: string;
  pageId?: string;
  sectionId?: string;
  reason: string;
};

export function applySiteDirectorDecisionsToPlan(input: {
  plan: GenerationPlanV2;
  decisions: SiteDirectorDecisionInput[];
  model: string;
  summary: string;
  appliedAt?: string;
}): { plan: GenerationPlanV2; issues: SiteDirectorDecisionIssue[] } {
  const issues = validateSiteDirectorDecisions(input.plan, input.decisions);
  if (issues.length) {
    return {
      plan: withSiteDirectorRun(input.plan, {
        status: "rejected",
        source: "openai",
        model: input.model,
        summary: input.summary,
        issues: issues.map((issue) => issue.reason),
        appliedAt: input.appliedAt
      }),
      issues
    };
  }

  const decisionsBySectionId = new Map(input.decisions.map((decision) => [decision.sectionId, decision]));
  const nextPlan: GenerationPlanV2 = {
    ...input.plan,
    source: "ai_site_director",
    director: createSiteDirectorMetadata({
      planningMode: "model_backed",
      model: input.model,
      deterministicPasses: input.plan.director.repairContract.deterministicPasses,
      aiRetries: input.plan.director.repairContract.aiRetries
    }),
    directorRun: {
      status: "applied",
      source: "openai",
      model: input.model,
      summary: input.summary,
      issues: [],
      appliedAt: input.appliedAt ?? new Date().toISOString()
    },
    pages: input.plan.pages.map((page) => ({
      ...page,
      sections: page.sections.map((section) => {
        const decision = decisionsBySectionId.get(section.id);
        return decision
          ? {
              ...section,
              intent: decision.headlineBrief ? `${section.intent} Director brief: ${decision.headlineBrief}` : section.intent,
              directorDecision: {
                action: decision.action,
                priority: decision.priority,
                rationale: decision.rationale,
                factIds: decision.factIds,
                allowedClaimCategories: decision.allowedClaimCategories,
                headlineBrief: decision.headlineBrief,
                bodyBrief: decision.bodyBrief,
                riskNotes: decision.riskNotes
              }
            }
          : section;
      })
    }))
  };
  return { plan: nextPlan, issues: [] };
}

export function withSiteDirectorRun(
  plan: GenerationPlanV2,
  run: NonNullable<GenerationPlanV2["directorRun"]>
): GenerationPlanV2 {
  return {
    ...plan,
    directorRun: {
      ...run,
      appliedAt: run.appliedAt ?? new Date().toISOString()
    }
  };
}

export function validateSiteDirectorDecisions(
  plan: GenerationPlanV2,
  decisions: SiteDirectorDecisionInput[]
): SiteDirectorDecisionIssue[] {
  const issues: SiteDirectorDecisionIssue[] = [];
  const allSections = plan.pages.flatMap((page) => page.sections.map((section) => ({ pageId: page.id, section })));
  const sectionById = new Map(allSections.map((entry) => [entry.section.id, entry]));
  const seen = new Set<string>();

  for (const decision of decisions) {
    const entry = sectionById.get(decision.sectionId);
    if (!entry) {
      issues.push({
        id: `unknown_section_${decision.sectionId}`,
        pageId: decision.pageId,
        sectionId: decision.sectionId,
        reason: `Site Director returned a decision for unknown section ${decision.sectionId}.`
      });
      continue;
    }
    if (seen.has(decision.sectionId)) {
      issues.push({
        id: `duplicate_section_${decision.sectionId}`,
        pageId: decision.pageId,
        sectionId: decision.sectionId,
        reason: `Site Director returned more than one decision for ${decision.sectionId}.`
      });
    }
    seen.add(decision.sectionId);
    if (decision.pageId !== entry.pageId) {
      issues.push({
        id: `wrong_page_${decision.sectionId}`,
        pageId: decision.pageId,
        sectionId: decision.sectionId,
        reason: `Site Director assigned ${decision.sectionId} to ${decision.pageId}, but the section belongs to ${entry.pageId}.`
      });
    }
    issues.push(...validateDecisionForSection(entry.section, decision, decision.pageId));
  }

  for (const entry of allSections) {
    if (seen.has(entry.section.id)) continue;
    issues.push({
      id: `missing_decision_${entry.section.id}`,
      pageId: entry.pageId,
      sectionId: entry.section.id,
      reason: `Site Director did not return a decision for ${entry.section.id}.`
    });
  }

  return issues;
}

export function validateDecisionForSection(
  section: GenerationPlanV2Section,
  decision: SiteDirectorSectionDecision | SiteDirectorDecisionInput,
  pageId?: string
): SiteDirectorDecisionIssue[] {
  const issues: SiteDirectorDecisionIssue[] = [];
  const allowedFactIds = new Set([...section.requiredFactIds, ...section.optionalFactIds]);
  const allowedClaimCategories = new Set(section.copyPolicy.allowedClaimCategories);
  const forbiddenClaimCategories = new Set(section.copyPolicy.forbiddenClaimCategories);

  if (decision.priority < 1 || decision.priority > 20 || !Number.isFinite(decision.priority)) {
    issues.push({
      id: `invalid_priority_${section.id}`,
      pageId,
      sectionId: section.id,
      reason: `Site Director priority for ${section.id} must be between 1 and 20.`
    });
  }
  if (decision.action === "omit") {
    issues.push({
      id: `omit_not_supported_${section.id}`,
      pageId,
      sectionId: section.id,
      reason: `Site Director cannot omit ${section.id} after deterministic section-catalog pruning; unsupported sections must be removed before model planning.`
    });
  }
  if (!decision.rationale.trim()) {
    issues.push({
      id: `missing_rationale_${section.id}`,
      pageId,
      sectionId: section.id,
      reason: `Site Director decision for ${section.id} must include a rationale.`
    });
  }
  for (const factId of decision.factIds) {
    if (allowedFactIds.has(factId)) continue;
    issues.push({
      id: `unsupported_fact_${section.id}_${factId}`,
      pageId,
      sectionId: section.id,
      reason: `Site Director referenced fact ${factId} for ${section.id}, but that fact is not allowed by the section contract.`
    });
  }
  for (const category of decision.allowedClaimCategories) {
    if (allowedClaimCategories.has(category) && !forbiddenClaimCategories.has(category)) continue;
    issues.push({
      id: `unsupported_claim_category_${section.id}_${category}`,
      pageId,
      sectionId: section.id,
      reason: `Site Director allowed ${category} claims for ${section.id}, but the section copy policy does not allow them.`
    });
  }
  return issues;
}

function missingFactBehaviorForSection(kind: LayoutSectionKind): SiteDirectorCopyPolicy["missingFactBehavior"] {
  if (kind === "hero" || kind === "contact" || kind === "services") return "block_generation";
  if (kind === "proof" || kind === "gallery" || kind === "before_after" || kind === "team" || kind === "map" || kind === "press") return "omit_section";
  return "render_without_claim";
}

function goalLabel(goal: ConversionGoal) {
  switch (goal) {
    case "calls":
      return "call";
    case "forms":
      return "form";
    case "booking_clicks":
      return "booking";
    case "order_clicks":
      return "ordering";
    case "directions":
    case "store_visits":
      return "visit";
  }
}
