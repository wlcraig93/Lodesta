import { factsByKind } from "./business-fact-graph";
import type {
  BusinessFactGraph,
  BusinessFactKind,
  CompiledSectionV2,
  ConversionGoal,
  GenerationPlanV2,
  GenerationPlanV2Section,
  LayoutSectionKind,
  SiteArtDirection,
  SiteBundle,
  SiteDirectorClaimCategory,
  SiteVersion,
  Vertical
} from "./models";
import { propsForLayoutSection } from "./layout-registry";
import {
  claimCategoriesForFactKind,
  createSiteDirectorMetadata,
  siteDirectorCopyPolicyForSection,
  siteDirectorIntentForSection,
  validateDecisionForSection
} from "./site-director";
import { missingRequiredFactKinds, sectionFactContractForSection } from "./section-catalog";

export type GenerationPlanV2ValidationIssue = {
  id: string;
  pageId?: string;
  sectionId?: string;
  reason: string;
};

export function createGenerationPlanV2(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  factGraph: BusinessFactGraph;
  createdAt?: string;
}): GenerationPlanV2 {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const primaryGoal = primaryGoalForBundle(input.bundle);
  const pages = input.version.rendererVersion === "layout-v2"
    ? input.version.compiledPages.map((page) => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
        sections: page.sections.map((section) =>
          planSectionFromCompiledSection({
            section,
            pageId: page.id,
            primaryGoal,
            artDirection: artDirectionForVertical(input.bundle.businessProfile.vertical),
            factGraph: input.factGraph
          })
        )
      }))
    : input.version.pages.map((page) => ({
      id: page.id,
      slug: page.slug,
      title: page.title,
      sections: page.layoutSections.map((section) => {
      const contract = sectionFactContractForSection(section, primaryGoal);
      const missing = missingRequiredFactKinds(input.factGraph, contract);
      const supportedRequiredAnyFactKinds = contract.requiredAnyFactKinds.filter((kind) => factsByKind(input.factGraph, kind).length > 0);
      const supportedOptionalFactKinds = contract.optionalFactKinds.filter((kind) => factsByKind(input.factGraph, kind).length > 0);
      return {
        id: section.id,
        kind: section.kind,
        catalogSection: section.preset,
        pageId: page.id,
        intent: siteDirectorIntentForSection({
          kind: section.kind,
          primaryGoal,
          artDirection: artDirectionForVertical(input.bundle.businessProfile.vertical)
        }),
        supportStatus: (missing.length ? "missing_required_facts" : "supported") as GenerationPlanV2Section["supportStatus"],
        rejectionBehavior: contract.missingFactBehavior,
        missingFactKinds: missing,
        requiredFactIds: factIds(input.factGraph, [...contract.requiredFactKinds, ...contract.requiredAnyFactKinds]),
        optionalFactIds: factIds(input.factGraph, contract.optionalFactKinds),
        requiredFactKinds: contract.requiredFactKinds,
        requiredAnyFactKinds: contract.requiredAnyFactKinds,
        optionalFactKinds: contract.optionalFactKinds,
        copyPolicy: siteDirectorCopyPolicyForSection({
          kind: section.kind,
          requiredFactKinds: [...contract.requiredFactKinds, ...supportedRequiredAnyFactKinds],
          optionalFactKinds: supportedOptionalFactKinds
        }),
        omittedReason: missing.length
          ? `Missing safe facts: ${missing.join(", ")}`
          : undefined
      };
      })
    }));
  const structuralRejections = pages.flatMap((page) =>
    page.sections
      .filter((section) => section.supportStatus === "missing_required_facts")
      .map((section) => ({
        id: `structural_${section.id}`,
        pageId: page.id,
        sectionId: section.id,
        catalogSection: section.catalogSection,
        action: section.rejectionBehavior,
        missingFactKinds: section.missingFactKinds,
        reason: section.omittedReason ?? `Missing safe facts for ${section.catalogSection}.`
      }))
  );

  return {
    id: `planv2_${input.bundle.businessProfile.siteId}`,
    siteId: input.bundle.businessProfile.siteId,
    source: "deterministic_contract_seed",
    createdAt,
    vertical: input.bundle.businessProfile.vertical,
    primaryGoal,
    artDirection: artDirectionForVertical(input.bundle.businessProfile.vertical),
    director: createSiteDirectorMetadata({
      planningMode: "deterministic_seed",
      deterministicPasses: 1,
      aiRetries: 1
    }),
    pages,
    omittedSections: omittedSections(input.factGraph, input.version),
    structuralRejections,
    verification: {
      status: "pending",
      unsupportedClaimCount: 0
    }
  };
}

export function validateGenerationPlanV2AgainstVersion(input: {
  plan: GenerationPlanV2;
  version: SiteVersion;
  factGraph: BusinessFactGraph;
}): GenerationPlanV2ValidationIssue[] {
  const issues: GenerationPlanV2ValidationIssue[] = [];
  const graphFactsById = new Map(input.factGraph.facts.map((fact) => [fact.id, fact]));
  const versionPagesById = new Map(input.version.pages.map((page) => [page.id, page]));
  const planPagesById = new Map(input.plan.pages.map((page) => [page.id, page]));

  if (input.version.rendererVersion === "layout-v2") {
    return validateGenerationPlanV2AgainstCompiledVersion(input);
  }

  for (const planPage of input.plan.pages) {
    const versionPage = versionPagesById.get(planPage.id);
    if (!versionPage) {
      issues.push({
        id: `unknown_plan_page_${planPage.id}`,
        pageId: planPage.id,
        reason: "The Site Director plan contains a page that is not present in the rendered site version."
      });
      continue;
    }
    const versionSectionIds = new Set(versionPage.layoutSections.map((section) => section.id));
    for (const planSection of planPage.sections) {
      if (versionSectionIds.has(planSection.id)) continue;
      issues.push({
        id: `unknown_plan_section_${planSection.id}`,
        pageId: planPage.id,
        sectionId: planSection.id,
        reason: "The Site Director plan contains a section that is not present in the rendered site version."
      });
    }
  }

  for (const page of input.version.pages) {
    const planPage = planPagesById.get(page.id);
    if (!planPage) {
      issues.push({
        id: `missing_plan_page_${page.id}`,
        pageId: page.id,
        reason: "The rendered site version has no matching Site Director page plan."
      });
      continue;
    }
    const planSectionsById = new Map(planPage.sections.map((section) => [section.id, section]));
    for (const section of page.layoutSections) {
      const planSection = planSectionsById.get(section.id);
      if (!planSection) {
        issues.push({
          id: `missing_plan_section_${section.id}`,
          pageId: page.id,
          sectionId: section.id,
          reason: "The rendered section has no matching Site Director section plan."
        });
        continue;
      }

      if (planSection.kind !== section.kind) {
        issues.push({
          id: `section_kind_mismatch_${section.id}`,
          pageId: page.id,
          sectionId: section.id,
          reason: `The Site Director planned ${planSection.kind}, but the rendered section is ${section.kind}.`
        });
      }
      if (planSection.catalogSection !== section.preset) {
        issues.push({
          id: `section_preset_mismatch_${section.id}`,
          pageId: page.id,
          sectionId: section.id,
          reason: `The Site Director planned ${planSection.catalogSection}, but the rendered section uses ${section.preset}.`
        });
      }

      const contract = sectionFactContractForSection(section, input.plan.primaryGoal);
      const expectedMissing = missingRequiredFactKinds(input.factGraph, contract);
      const expectedSupportStatus: GenerationPlanV2Section["supportStatus"] = expectedMissing.length ? "missing_required_facts" : "supported";
      if (planSection.supportStatus !== expectedSupportStatus) {
        issues.push({
          id: `support_status_mismatch_${section.id}`,
          pageId: page.id,
          sectionId: section.id,
          reason: `The Site Director support status is ${planSection.supportStatus}, but the fact contract resolves to ${expectedSupportStatus}.`
        });
      }
      if (!sameStringSet(planSection.missingFactKinds, expectedMissing)) {
        issues.push({
          id: `missing_facts_mismatch_${section.id}`,
          pageId: page.id,
          sectionId: section.id,
          reason: `The Site Director missing facts are ${formatList(planSection.missingFactKinds)}, but the fact contract resolves to ${formatList(expectedMissing)}.`
        });
      }
      if (!sameStringSet(planSection.requiredFactKinds, contract.requiredFactKinds)) {
        issues.push({
          id: `required_kinds_mismatch_${section.id}`,
          pageId: page.id,
          sectionId: section.id,
          reason: "The Site Director required fact kinds do not match the registered section fact contract."
        });
      }
      if (!sameStringSet(planSection.requiredAnyFactKinds, contract.requiredAnyFactKinds)) {
        issues.push({
          id: `required_any_kinds_mismatch_${section.id}`,
          pageId: page.id,
          sectionId: section.id,
          reason: "The Site Director alternative required fact kinds do not match the registered section fact contract."
        });
      }
      if (!sameStringSet(planSection.optionalFactKinds, contract.optionalFactKinds)) {
        issues.push({
          id: `optional_kinds_mismatch_${section.id}`,
          pageId: page.id,
          sectionId: section.id,
          reason: "The Site Director optional fact kinds do not match the registered section fact contract."
        });
      }

      issues.push(...factIdIssues({
        ids: planSection.requiredFactIds,
        allowedKinds: new Set([...contract.requiredFactKinds, ...contract.requiredAnyFactKinds]),
        graphFactsById,
        pageId: page.id,
        sectionId: section.id,
        role: "required"
      }));
      issues.push(...factIdIssues({
        ids: planSection.optionalFactIds,
        allowedKinds: new Set(contract.optionalFactKinds),
        graphFactsById,
        pageId: page.id,
        sectionId: section.id,
        role: "optional"
      }));

      for (const category of unsupportedCopyPolicyCategories(planSection, graphFactsById)) {
        issues.push({
          id: `unsupported_copy_category_${section.id}_${category}`,
          pageId: page.id,
          sectionId: section.id,
          reason: `The Site Director copy policy allows ${category} claims without matching safe fact ids on this section.`
        });
      }
      for (const category of sensitiveClaimCategories) {
        if (planSection.copyPolicy.forbiddenClaimCategories.includes(category)) continue;
        issues.push({
          id: `sensitive_category_not_forbidden_${section.id}_${category}`,
          pageId: page.id,
          sectionId: section.id,
          reason: `The Site Director copy policy must forbid ${category} claims unless a dedicated verifier supports them.`
        });
      }
      if (input.plan.source === "ai_site_director" && !planSection.directorDecision) {
        issues.push({
          id: `missing_director_decision_${section.id}`,
          pageId: page.id,
          sectionId: section.id,
          reason: "Model-backed Site Director plans must include an accepted decision for every rendered section."
        });
      }
      if (planSection.directorDecision) {
        for (const issue of validateDecisionForSection(planSection, planSection.directorDecision, page.id)) {
          issues.push({
            id: `director_decision_${issue.id}`,
            pageId: issue.pageId,
            sectionId: issue.sectionId,
            reason: issue.reason
          });
        }
      }
    }
  }

  return issues;
}

function primaryGoalForBundle(bundle: SiteBundle): ConversionGoal {
  const home = bundle.siteModel.versions[0]?.pages[0];
  const hero = home?.layoutSections.find((section) => section.kind === "hero");
  const primaryCta = hero ? propsForLayoutSection(hero).primaryCta : undefined;
  if (isRecord(primaryCta) && primaryCta.role === "tel") return "calls";
  if (isRecord(primaryCta) && primaryCta.role === "booking") return "booking_clicks";
  if (isRecord(primaryCta) && primaryCta.role === "ordering") return "order_clicks";
  if (bundle.businessProfile.bookingLinks.length) return "booking_clicks";
  if (bundle.businessProfile.orderingLinks.length) return "order_clicks";
  if (bundle.businessProfile.phone) return "calls";
  return "forms";
}

function validateGenerationPlanV2AgainstCompiledVersion(input: {
  plan: GenerationPlanV2;
  version: SiteVersion;
  factGraph: BusinessFactGraph;
}): GenerationPlanV2ValidationIssue[] {
  if (input.version.rendererVersion !== "layout-v2") return [];
  const issues: GenerationPlanV2ValidationIssue[] = [];
  const versionPagesById = new Map(input.version.compiledPages.map((page) => [page.id, page]));
  const planPagesById = new Map(input.plan.pages.map((page) => [page.id, page]));
  const validFactIds = new Set([
    ...input.factGraph.facts.map((fact) => fact.id),
    ...(input.factGraph.sourceFactsV2 ?? []).map((fact) => fact.id)
  ]);

  for (const planPage of input.plan.pages) {
    const versionPage = versionPagesById.get(planPage.id);
    if (!versionPage) {
      issues.push({
        id: `unknown_plan_page_${planPage.id}`,
        pageId: planPage.id,
        reason: "The Site Director plan contains a page that is not present in the rendered V2 site version."
      });
      continue;
    }
    const versionSectionsById = new Map(versionPage.sections.map((section) => [section.id, section]));
    for (const planSection of planPage.sections) {
      const versionSection = versionSectionsById.get(planSection.id);
      if (!versionSection) {
        issues.push({
          id: `unknown_plan_section_${planSection.id}`,
          pageId: planPage.id,
          sectionId: planSection.id,
          reason: "The Site Director plan contains a section that is not present in the rendered V2 site version."
        });
        continue;
      }
      const expectedKind = layoutKindForCompiledFamily(versionSection.family);
      if (planSection.kind !== expectedKind) {
        issues.push({
          id: `section_kind_mismatch_${versionSection.id}`,
          pageId: planPage.id,
          sectionId: versionSection.id,
          reason: `The Site Director planned ${planSection.kind}, but the rendered V2 section is ${expectedKind}.`
        });
      }
      if (planSection.catalogSection !== versionSection.family) {
        issues.push({
          id: `section_preset_mismatch_${versionSection.id}`,
          pageId: planPage.id,
          sectionId: versionSection.id,
          reason: `The Site Director planned ${planSection.catalogSection}, but the rendered V2 section uses ${versionSection.family}.`
        });
      }
      for (const factId of [...planSection.requiredFactIds, ...planSection.optionalFactIds]) {
        if (validFactIds.has(factId)) continue;
        issues.push({
          id: `unknown_fact_${planSection.id}_${factId}`,
          pageId: planPage.id,
          sectionId: planSection.id,
          reason: `The Site Director plan references fact ${factId}, which is not present in the V2 fact graph.`
        });
      }
      for (const category of sensitiveClaimCategories) {
        if (planSection.copyPolicy.forbiddenClaimCategories.includes(category)) continue;
        issues.push({
          id: `sensitive_category_not_forbidden_${planSection.id}_${category}`,
          pageId: planPage.id,
          sectionId: planSection.id,
          reason: `The Site Director copy policy must forbid ${category} claims unless a dedicated verifier supports them.`
        });
      }
      if (input.plan.source === "ai_site_director" && !planSection.directorDecision) {
        issues.push({
          id: `missing_director_decision_${planSection.id}`,
          pageId: planPage.id,
          sectionId: planSection.id,
          reason: "Model-backed Site Director plans must include an accepted decision for every rendered V2 section."
        });
      }
    }
  }

  for (const page of input.version.compiledPages) {
    const planPage = planPagesById.get(page.id);
    if (!planPage) {
      issues.push({
        id: `missing_plan_page_${page.id}`,
        pageId: page.id,
        reason: "The rendered V2 site version has no matching Site Director page plan."
      });
      continue;
    }
    const planSectionsById = new Map(planPage.sections.map((section) => [section.id, section]));
    for (const section of page.sections) {
      if (planSectionsById.has(section.id)) continue;
      issues.push({
        id: `missing_plan_section_${section.id}`,
        pageId: page.id,
        sectionId: section.id,
        reason: "The rendered V2 section has no matching Site Director section plan."
      });
    }
  }

  return issues;
}

function planSectionFromCompiledSection(input: {
  section: CompiledSectionV2;
  pageId: string;
  primaryGoal: ConversionGoal;
  artDirection: SiteArtDirection;
  factGraph: BusinessFactGraph;
}): GenerationPlanV2Section {
  const requiredFactIds = Array.from(new Set(input.section.sourceFactIds));
  const requiredFactKinds = factKindsForIds(input.factGraph, requiredFactIds);
  const kind = layoutKindForCompiledFamily(input.section.family);
  const copyPolicy = siteDirectorCopyPolicyForSection({
    kind,
    requiredFactKinds,
    optionalFactKinds: []
  });
  return {
    id: input.section.id,
    kind,
    catalogSection: input.section.family,
    pageId: input.pageId,
    intent: siteDirectorIntentForSection({
      kind,
      primaryGoal: input.primaryGoal,
      artDirection: input.artDirection
    }),
    supportStatus: "supported",
    rejectionBehavior: copyPolicy.missingFactBehavior,
    missingFactKinds: [],
    requiredFactIds,
    optionalFactIds: [],
    requiredFactKinds,
    requiredAnyFactKinds: [],
    optionalFactKinds: [],
    copyPolicy
  };
}

function layoutKindForCompiledFamily(family: CompiledSectionV2["family"]): LayoutSectionKind {
  if (family.startsWith("hero.")) return "hero";
  if (family.startsWith("services.")) return "services";
  if (family.startsWith("menu.")) return "menu";
  if (family.startsWith("media.")) return "gallery";
  if (family.startsWith("process.")) return "proof";
  if (family.startsWith("proof.")) return "proof";
  if (family.startsWith("guidance.")) return "trust";
  if (family.startsWith("faq.")) return "faq";
  if (family.startsWith("coverage.")) return "map";
  if (family.startsWith("contact.")) return "contact";
  if (family.startsWith("cta.")) return "cta";
  return "trust";
}

function factKindsForIds(graph: BusinessFactGraph, ids: string[]): BusinessFactKind[] {
  const legacyFacts = new Map(graph.facts.map((fact) => [fact.id, fact.kind] as const));
  const sourceFacts = new Map((graph.sourceFactsV2 ?? []).map((fact) => [fact.id, fact.kind] as const));
  return Array.from(new Set(ids.map((id) => sourceFacts.get(id) ?? legacyFacts.get(id)).filter(Boolean))) as BusinessFactKind[];
}

function artDirectionForVertical(vertical: Vertical): SiteArtDirection {
  if (vertical === "restaurant") return "warm_local";
  if (vertical === "dental" || vertical === "med_spa" || vertical === "veterinary") return "clinical_trust";
  if (vertical === "law_firm" || vertical === "real_estate") return "premium_professional";
  if (vertical === "landscaping" || vertical === "beauty_salon" || vertical === "creative_studio") return "visual_craft";
  return "precision_service";
}

function factIds(graph: BusinessFactGraph, kinds: BusinessFactKind[]) {
  return kinds.flatMap((kind) => factsByKind(graph, kind).map((fact) => fact.id));
}

function missingKinds(graph: BusinessFactGraph, kinds: BusinessFactKind[]) {
  return kinds.filter((kind) => factsByKind(graph, kind).length === 0);
}

function omittedSections(graph: BusinessFactGraph, version: SiteVersion): GenerationPlanV2["omittedSections"] {
  const omitted: GenerationPlanV2["omittedSections"] = [];
  const existingKinds = new Set(version.pages.flatMap((page) => page.layoutSections.map((section) => section.kind)));
  const candidates: Array<{ kind: LayoutSectionKind; catalogSection: string; missingFactKinds: BusinessFactKind[] }> = [
    { kind: "proof", catalogSection: "proof.review_band", missingFactKinds: ["review_summary"] },
    { kind: "gallery", catalogSection: "gallery.proof_grid", missingFactKinds: ["photo"] },
    { kind: "map", catalogSection: "map.service_area", missingFactKinds: ["address"] },
    { kind: "team", catalogSection: "team.profile_grid", missingFactKinds: ["proof_signal"] }
  ];
  for (const candidate of candidates) {
    if (existingKinds.has(candidate.kind)) continue;
    const missing = missingKinds(graph, candidate.missingFactKinds);
    if (missing.length) {
      omitted.push({
        catalogSection: candidate.catalogSection,
        reason: `Not enough safe source-backed facts for ${candidate.catalogSection}.`,
        missingFactKinds: missing
      });
    }
  }
  return omitted;
}

const sensitiveClaimCategories: SiteDirectorClaimCategory[] = [
  "credentials",
  "insurance",
  "pricing",
  "warranty",
  "emergency",
  "regulated"
];

const baselineCopyCategories = new Set<SiteDirectorClaimCategory>(["business_identity", "service", "contact"]);

function factIdIssues(input: {
  ids: string[];
  allowedKinds: Set<BusinessFactKind>;
  graphFactsById: Map<string, BusinessFactGraph["facts"][number]>;
  pageId: string;
  sectionId: string;
  role: "required" | "optional";
}): GenerationPlanV2ValidationIssue[] {
  const issues: GenerationPlanV2ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const id of input.ids) {
    if (seen.has(id)) {
      issues.push({
        id: `duplicate_${input.role}_fact_${input.sectionId}_${id}`,
        pageId: input.pageId,
        sectionId: input.sectionId,
        reason: `The Site Director references ${input.role} fact ${id} more than once.`
      });
      continue;
    }
    seen.add(id);
    const fact = input.graphFactsById.get(id);
    if (!fact) {
      issues.push({
        id: `unknown_${input.role}_fact_${input.sectionId}_${id}`,
        pageId: input.pageId,
        sectionId: input.sectionId,
        reason: `The Site Director references ${input.role} fact ${id}, but it is not in the business fact graph.`
      });
      continue;
    }
    if (!input.allowedKinds.has(fact.kind)) {
      issues.push({
        id: `wrong_${input.role}_fact_kind_${input.sectionId}_${id}`,
        pageId: input.pageId,
        sectionId: input.sectionId,
        reason: `The Site Director references ${input.role} ${fact.kind} fact ${id}, but that kind is not allowed by the section contract.`
      });
    }
    if (fact.renderSafety === "blocked" || fact.renderSafety === "internal_only") {
      issues.push({
        id: `unsafe_${input.role}_fact_${input.sectionId}_${id}`,
        pageId: input.pageId,
        sectionId: input.sectionId,
        reason: `The Site Director references ${input.role} fact ${id}, but its render safety is ${fact.renderSafety}.`
      });
    }
  }
  return issues;
}

function unsupportedCopyPolicyCategories(
  section: GenerationPlanV2Section,
  graphFactsById: Map<string, BusinessFactGraph["facts"][number]>
): SiteDirectorClaimCategory[] {
  const supportedCategories = new Set<SiteDirectorClaimCategory>(baselineCopyCategories);
  for (const id of [...section.requiredFactIds, ...section.optionalFactIds]) {
    const fact = graphFactsById.get(id);
    if (!fact || fact.renderSafety === "blocked" || fact.renderSafety === "internal_only") continue;
    for (const category of claimCategoriesForFactKind(fact.kind)) supportedCategories.add(category);
  }
  return section.copyPolicy.allowedClaimCategories.filter((category) => !supportedCategories.has(category));
}

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function formatList(values: string[]) {
  return values.length ? values.join(", ") : "none";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
