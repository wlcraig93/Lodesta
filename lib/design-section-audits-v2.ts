import { createHash } from "node:crypto";
import type { CompiledPageV2, CompiledSectionV2, SiteArtifactRecord, SiteBundle, SiteVersion, SourceAwareFactV2 } from "./models";

export type DesignSectionAuditSkillIdV2 =
  | "design.site-system"
  | "design.header-system"
  | "design.section-composition"
  | "section.service-matrix"
  | "section.proof-review"
  | "section.contact-location-hours";

export type DesignSectionAuditFindingV2 = {
  id: string;
  severity: "pass" | "watch" | "blocking";
  detail: string;
  recommendedAction: string;
  affectedPageId?: string;
  affectedSectionId?: string;
  evidenceFactIds: string[];
};

export type DesignSectionAuditReportV2 = {
  skillId: DesignSectionAuditSkillIdV2;
  versionId?: string;
  status: "ready" | "needs_review" | "blocked";
  findings: DesignSectionAuditFindingV2[];
  scorecard: {
    passes: number;
    watchItems: number;
    blockers: number;
  };
};

export type DesignSectionAuditsV2Result = {
  skillIds: DesignSectionAuditSkillIdV2[];
  skillVersion: "direct-module-v1";
  versionId?: string;
  reports: DesignSectionAuditReportV2[];
  artifacts: SiteArtifactRecord[];
  summary: string;
};

export function runDesignSectionAuditsV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): DesignSectionAuditsV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const facts = input.bundle.presenceAssessment.businessFactGraph?.sourceFactsV2 ?? [];
  const pages = version?.rendererVersion === "layout-v2" ? version.compiledPages : [];
  const reports = [
    report("design.site-system", version?.id, siteSystemFindings(version)),
    report("design.header-system", version?.id, headerFindings(version, pages)),
    report("design.section-composition", version?.id, sectionCompositionFindings(version, pages)),
    report("section.service-matrix", version?.id, serviceMatrixFindings(pages, facts)),
    report("section.proof-review", version?.id, proofReviewFindings(pages, facts)),
    report("section.contact-location-hours", version?.id, contactLocationHoursFindings(pages, facts, input.bundle))
  ];
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const artifacts = reports.map((item) => artifactForReport({
    siteId,
    report: item,
    version,
    createdAt: input.createdAt
  }));
  const blockers = reports.reduce((sum, item) => sum + item.scorecard.blockers, 0);
  const watchItems = reports.reduce((sum, item) => sum + item.scorecard.watchItems, 0);

  return {
    skillIds: reports.map((item) => item.skillId),
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    reports,
    artifacts,
    summary: `${reports.length} design/section audits ran; ${blockers} blockers, ${watchItems} watch item${watchItems === 1 ? "" : "s"}.`
  };
}

function siteSystemFindings(version: SiteVersion | undefined): DesignSectionAuditFindingV2[] {
  if (version?.rendererVersion !== "layout-v2") return [blocking("site_system_layout_v2_required", "Site design system audits require a layout-v2 version.", "Generate or select a layout-v2 version before auditing site-specific tokens.")];
  const design = version.siteDesignSystem;
  return [
    passOrWatch(design.buttons.variants.length >= 2, "site_system_button_variants", "Site has at least two bounded button variants.", "Add primary and secondary site-scoped variants before acceptance."),
    passOrWatch(design.typography.headingFamily !== design.typography.bodyFamily || design.typography.headingWeight !== design.typography.bodyWeight, "site_system_type_hierarchy", "Typography has visible heading/body separation.", "Choose a bounded type recipe with stronger heading/body hierarchy."),
    passOrWatch(design.color.primary !== design.color.background && design.color.primaryText !== design.color.primary, "site_system_color_separation", "Primary CTA colors are distinct from the page background.", "Select a token recipe with clearer CTA contrast."),
    passOrWatch(Boolean(design.media.treatment), "site_system_media_treatment", "Media treatment is explicitly tokenized.", "Set a bounded media treatment before rendering public sections.")
  ];
}

function headerFindings(version: SiteVersion | undefined, pages: CompiledPageV2[]): DesignSectionAuditFindingV2[] {
  if (version?.rendererVersion !== "layout-v2") return [blocking("header_layout_v2_required", "Header audits require a layout-v2 version.", "Generate or select a layout-v2 version before auditing headers.")];
  const hero = firstSection(pages, (section) => section.family.startsWith("hero."));
  return [
    passOrWatch(["transparent_overlay", "adaptive_overlay", "solid_sticky", "shrinking_sticky"].includes(version.siteDesignSystem.header.mode), "header_mode_bounded", `Header mode is ${version.siteDesignSystem.header.mode}.`, "Use one of the bounded HeaderSystemV2 modes."),
    passOrWatch(Boolean(version.siteDesignSystem.header.mobileBehavior), "header_mobile_behavior", `Mobile header behavior is ${version.siteDesignSystem.header.mobileBehavior}.`, "Set drawer or compact-links behavior so mobile navigation does not wrap."),
    passOrWatch(Boolean(hero), "header_hero_pairing", "A hero section exists for header pairing.", "Add a supported hero section so the header can attach to the top of the generated page.")
  ];
}

function sectionCompositionFindings(version: SiteVersion | undefined, pages: CompiledPageV2[]): DesignSectionAuditFindingV2[] {
  if (version?.rendererVersion !== "layout-v2") return [blocking("composition_layout_v2_required", "Section composition audits require a layout-v2 version.", "Generate or select a layout-v2 version before auditing section composition.")];
  const home = pages[0];
  const sections = home?.sections ?? [];
  const uniqueFamilies = new Set(sections.map((section) => section.family));
  return [
    passOrWatch(sections.length >= 3, "composition_minimum_honest_site", `Home page has ${sections.length} sections.`, "Auto-body V2 needs at least hero, service matrix, and contact/location sections."),
    passOrWatch(sections.length >= 6, "composition_production_depth", `Home page has ${sections.length} sections; production target is 6+ when facts support it.`, "Add only fact-supported depth; do not create filler sections."),
    passOrWatch(uniqueFamilies.size >= 4, "composition_layout_diversity", `Home page uses ${uniqueFamilies.size} section families.`, "Use at least four distinct section families when source facts support them.")
  ];
}

function serviceMatrixFindings(pages: CompiledPageV2[], facts: SourceAwareFactV2[]): DesignSectionAuditFindingV2[] {
  const section = firstSection(pages, (candidate) => candidate.family === "services.matrix");
  const serviceFacts = durableFacts(facts, "service");
  if (!section) return [blocking("service_matrix_missing", "No services.matrix section is compiled.", "Compile a services matrix for supported local-service verticals.")];
  const serviceCount = Array.isArray(section.props.services) ? section.props.services.length : 0;
  return [
    passOrWatch(serviceCount >= 3, "service_matrix_depth", `Service matrix has ${serviceCount} services.`, "Use durable service facts to show enough real service depth."),
    passOrWatch(serviceFacts.length >= serviceCount, "service_matrix_fact_support", `${serviceFacts.length} durable service facts support the matrix.`, "Do not render unsupported service cards."),
    passOrWatch(section.sourceFactIds.length > 0, "service_matrix_section_provenance", "Service matrix carries source fact ids.", "Attach source fact ids to every compiled service section.")
  ].map((finding) => ({ ...finding, affectedSectionId: section.id, evidenceFactIds: serviceFacts.map((fact) => fact.id) }));
}

function proofReviewFindings(pages: CompiledPageV2[], facts: SourceAwareFactV2[]): DesignSectionAuditFindingV2[] {
  const proofSections = pages.flatMap((page) => page.sections.filter((section) => section.family.startsWith("proof.") || section.props.proofItems));
  const proofFacts = facts.filter((fact) => fact.kind === "proof_signal" || fact.kind === "review_summary");
  if (!proofSections.length && !proofFacts.length) {
    return [
      {
        id: "proof_omit_when_missing",
        severity: "pass",
        detail: "No proof section is compiled because no durable proof evidence is available.",
        recommendedAction: "Keep proof-heavy sections omitted until social-proof or first-party evidence is available.",
        evidenceFactIds: []
      }
    ];
  }
  return [
    passOrWatch(proofSections.length > 0, "proof_section_present", `${proofSections.length} proof-capable section(s) compiled.`, "Add a proof section only with durable or live-only proof evidence."),
    passOrWatch(proofFacts.every((fact) => fact.sourcePolicy !== "blocked"), "proof_policy_safe", `${proofFacts.length} proof fact(s) checked for policy safety.`, "Remove blocked proof facts from public planning.")
  ].map((finding) => ({ ...finding, affectedSectionId: proofSections[0]?.id, evidenceFactIds: proofFacts.map((fact) => fact.id) }));
}

function contactLocationHoursFindings(pages: CompiledPageV2[], facts: SourceAwareFactV2[], bundle: SiteBundle): DesignSectionAuditFindingV2[] {
  const section = firstSection(pages, (candidate) => candidate.family === "contact.location_hours");
  if (!section) return [blocking("contact_location_missing", "No contact.location_hours section is compiled.", "Compile a contact/location section for local-business sites.")];
  const phoneFacts = durableFacts(facts, "phone");
  const addressFacts = durableFacts(facts, "address");
  const hoursFacts = durableFacts(facts, "hours");
  const findings: DesignSectionAuditFindingV2[] = [
    passOrWatch(Boolean(bundle.businessProfile.phone || phoneFacts.length), "contact_phone_available", "Phone is available for contact rendering.", "Confirm a phone number or adjust CTA strategy."),
    passOrWatch(Boolean(bundle.businessProfile.address || addressFacts.length), "contact_address_available", "Address or location context is available.", "Confirm address or service-area context before rendering a location panel."),
    {
      id: "contact_hours_policy",
      severity: bundle.businessProfile.hours || hoursFacts.length ? "pass" : "watch",
      detail: bundle.businessProfile.hours || hoursFacts.length ? "Hours are available." : "Hours are unavailable; section must use call-to-confirm language.",
      recommendedAction: "Do not block legitimate businesses for missing hours, but never imply known hours without evidence.",
      affectedSectionId: section.id,
      evidenceFactIds: hoursFacts.map((fact) => fact.id)
    }
  ];
  return findings.map((finding) => ({
    ...finding,
    affectedSectionId: section.id,
    evidenceFactIds: Array.from(new Set([...(finding.evidenceFactIds ?? []), ...phoneFacts.map((fact) => fact.id), ...addressFacts.map((fact) => fact.id)]))
  }));
}

function report(skillId: DesignSectionAuditSkillIdV2, versionId: string | undefined, findings: DesignSectionAuditFindingV2[]): DesignSectionAuditReportV2 {
  const scorecard = {
    passes: findings.filter((finding) => finding.severity === "pass").length,
    watchItems: findings.filter((finding) => finding.severity === "watch").length,
    blockers: findings.filter((finding) => finding.severity === "blocking").length
  };
  return {
    skillId,
    versionId,
    status: scorecard.blockers ? "blocked" : scorecard.watchItems ? "needs_review" : "ready",
    findings,
    scorecard
  };
}

function artifactForReport(input: {
  siteId: string;
  report: DesignSectionAuditReportV2;
  version?: SiteVersion;
  createdAt?: string;
}): SiteArtifactRecord {
  const payload = { report: input.report };
  const contentHash = hashPayload(payload);
  return {
    id: `artifact_${input.siteId}_${input.report.skillId.replace(/[^a-z0-9]+/g, "_")}_${contentHash.slice(0, 16)}`,
    siteId: input.siteId,
    scope: "site_alternative",
    artifactType: "design_section_audit_report",
    artifactVersion: "design-section-audit-v2",
    producerId: input.report.skillId,
    producerVersion: "direct-module-v1",
    verticalPlaybookVersion: input.version?.rendererVersion === "layout-v2" ? input.version.blueprint.verticalPlaybookVersion : undefined,
    siteDesignSystemVersion: input.version?.rendererVersion === "layout-v2" ? input.version.siteDesignSystem.version : undefined,
    sourceFactIds: Array.from(new Set(input.report.findings.flatMap((finding) => finding.evidenceFactIds))),
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

function firstSection(pages: CompiledPageV2[], predicate: (section: CompiledSectionV2) => boolean) {
  for (const page of pages) {
    const section = page.sections.find(predicate);
    if (section) return section;
  }
  return undefined;
}

function durableFacts(facts: SourceAwareFactV2[], kind: SourceAwareFactV2["kind"]) {
  return facts.filter((fact) => fact.kind === kind && fact.renderPolicy === "durable_render" && fact.sourcePolicy === "durable_render");
}

function passOrWatch(passed: boolean, id: string, detail: string, recommendedAction: string): DesignSectionAuditFindingV2 {
  return {
    id,
    severity: passed ? "pass" : "watch",
    detail,
    recommendedAction,
    evidenceFactIds: []
  };
}

function blocking(id: string, detail: string, recommendedAction: string): DesignSectionAuditFindingV2 {
  return {
    id,
    severity: "blocking",
    detail,
    recommendedAction,
    evidenceFactIds: []
  };
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
