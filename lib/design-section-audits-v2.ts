import { createHash } from "node:crypto";
import type { PageCompositionV3, SiteArtifactRecord, SiteBundle, SiteVersion, SiteVersionV3, SourceAwareFactV2 } from "./models";
import { getVisualSectionV3 } from "./generated-site-v3-visual-controls";
import { assertSiteVersionV3 } from "./site-version-v3";

type PageV3 = PageCompositionV3["pages"][number];
type SectionV3 = PageV3["sections"][number];

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
  const version = assertSiteVersionV3(
    input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0],
    "design section audit version"
  );
  const facts = input.bundle.presenceAssessment.businessFactGraph?.sourceFactsV2 ?? [];
  const pages = version.pageComposition.pages;
  const reports = [
    report("design.site-system", version.id, siteSystemFindings(version)),
    report("design.header-system", version.id, headerFindings(pages)),
    report("design.section-composition", version.id, sectionCompositionFindings(pages)),
    report("section.service-matrix", version.id, serviceMatrixFindings(pages, facts)),
    report("section.proof-review", version.id, proofReviewFindings(pages, facts)),
    report("section.contact-location-hours", version.id, contactLocationHoursFindings(pages, facts, input.bundle))
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
    versionId: version.id,
    reports,
    artifacts,
    summary: `${reports.length} design/section audits ran over layout-v3 pageComposition; ${blockers} blockers, ${watchItems} watch item${watchItems === 1 ? "" : "s"}.`
  };
}

function siteSystemFindings(version: SiteVersionV3): DesignSectionAuditFindingV2[] {
  const design = version.designPlan;
  return [
    passOrWatch(Boolean(design?.buttonStyle), "site_system_button_style", "V3 design plan has a bounded button style.", "Compile with a bounded v3 design plan."),
    passOrWatch(Boolean(design?.typographyPack), "site_system_type_pack", "V3 design plan has a bounded typography pack.", "Compile with a bounded v3 typography pack."),
    passOrWatch(Boolean(version.artDirection), "site_system_art_direction", "V3 art direction is attached.", "Compile with v3 art direction before auditing sections."),
    passOrWatch(version.mediaDecisions.every((decision) => decision.rightsStatus !== "restricted"), "site_system_media_rights", "Media decisions avoid restricted assets.", "Remove restricted media decisions before publish.")
  ];
}

function headerFindings(pages: PageV3[]): DesignSectionAuditFindingV2[] {
  const hero = firstSection(pages, (section) => section.family.startsWith("hero.") || Boolean(getVisualSectionV3(section.props)?.templateId.startsWith("hero_")));
  return [
    passOrWatch(Boolean(hero), "header_hero_pairing", "A v3 hero section exists for header pairing.", "Add a v3 hero section so the header can attach to the top of the generated page."),
    passOrWatch(Boolean(hero && getVisualSectionV3(hero.props)), "header_visual_section_contract", "Hero section has visualSectionV3.", "Recompile sections through the v3 compiler.")
  ];
}

function sectionCompositionFindings(pages: PageV3[]): DesignSectionAuditFindingV2[] {
  const home = pages.find((page) => page.slug === "") ?? pages[0];
  const sections = home?.sections ?? [];
  const uniqueFamilies = new Set(sections.map((section) => section.family));
  const missingVisual = sections.filter((section) => !getVisualSectionV3(section.props));
  return [
    passOrWatch(sections.length >= 5, "composition_minimum_honest_site", `Home page has ${sections.length} v3 sections.`, "Compile at least hero, service, proof/intro, FAQ or guidance, and contact when facts support them."),
    passOrWatch(uniqueFamilies.size >= 4, "composition_layout_diversity", `Home page uses ${uniqueFamilies.size} section families.`, "Use at least four distinct section families when source facts support them."),
    passOrWatch(missingVisual.length === 0, "composition_visual_contract", `${missingVisual.length} section(s) are missing visualSectionV3.`, "Never persist v3 sections without compiler-produced visualSectionV3.")
  ];
}

function serviceMatrixFindings(pages: PageV3[], facts: SourceAwareFactV2[]): DesignSectionAuditFindingV2[] {
  const section = firstSection(pages, (candidate) => candidate.family.startsWith("services.") || candidate.family.startsWith("menu."));
  const serviceFacts = durableFacts(facts, "service");
  if (!section) return [blocking("service_section_missing", "No v3 service/menu section is composed.", "Compile a services or menu section for supported local-service verticals.")];
  const renderedServices = textValues(section.props).filter((text) => serviceFacts.some((fact) => normalize(text).includes(normalize(String(fact.value)))));
  return [
    passOrWatch(renderedServices.length > 0 || serviceFacts.length === 0, "service_section_fact_support", `${renderedServices.length} durable service fact(s) surfaced in the section.`, "Do not render unsupported service cards."),
    passOrWatch(Boolean(getVisualSectionV3(section.props)), "service_section_visual_contract", "Service section has visualSectionV3.", "Recompile through the v3 compiler.")
  ].map((finding) => ({ ...finding, affectedSectionId: section.id, evidenceFactIds: serviceFacts.map((fact) => fact.id) }));
}

function proofReviewFindings(pages: PageV3[], facts: SourceAwareFactV2[]): DesignSectionAuditFindingV2[] {
  const proofSections = pages.flatMap((page) =>
    page.sections.filter((section) => {
      const templateId = getVisualSectionV3(section.props)?.templateId ?? "";
      return section.family.startsWith("proof.") || section.family.startsWith("trust.") || templateId === "quote_wall" || templateId === "stat_band" || templateId === "facts_strip";
    })
  );
  const proofFacts = facts.filter((fact) => fact.kind === "proof_signal" || fact.kind === "review_summary");
  if (!proofSections.length && !proofFacts.length) {
    return [{
      id: "proof_omit_when_missing",
      severity: "pass",
      detail: "No proof-heavy section is composed because no durable proof evidence is available.",
      recommendedAction: "Keep proof-heavy sections omitted until social-proof or first-party evidence is available.",
      evidenceFactIds: []
    }];
  }
  return [
    passOrWatch(proofSections.length > 0, "proof_section_present", `${proofSections.length} proof-capable section(s) composed.`, "Add a proof section only with durable or live-only proof evidence."),
    passOrWatch(proofFacts.every((fact) => fact.sourcePolicy !== "blocked"), "proof_policy_safe", `${proofFacts.length} proof fact(s) checked for policy safety.`, "Remove blocked proof facts from public planning.")
  ].map((finding) => ({ ...finding, affectedSectionId: proofSections[0]?.id, evidenceFactIds: proofFacts.map((fact) => fact.id) }));
}

function contactLocationHoursFindings(pages: PageV3[], facts: SourceAwareFactV2[], bundle: SiteBundle): DesignSectionAuditFindingV2[] {
  const section = firstSection(pages, (candidate) => {
    const templateId = getVisualSectionV3(candidate.props)?.templateId ?? "";
    return candidate.family.startsWith("contact.") || templateId === "contact_split" || templateId === "location_showcase";
  });
  if (!section) return [blocking("contact_section_missing", "No v3 contact/location section is composed.", "Compile a contact or location section for local-business sites.")];
  const phoneFacts = durableFacts(facts, "phone");
  const addressFacts = durableFacts(facts, "address");
  const hoursFacts = durableFacts(facts, "hours");
  const hoursSeverity: DesignSectionAuditFindingV2["severity"] = bundle.businessProfile.hours || hoursFacts.length ? "pass" : "watch";
  return [
    passOrWatch(Boolean(bundle.businessProfile.phone || phoneFacts.length), "contact_phone_available", "Phone is available for contact rendering.", "Confirm a phone number or adjust CTA strategy."),
    passOrWatch(Boolean(bundle.businessProfile.address || addressFacts.length || bundle.businessProfile.serviceAreas.length), "contact_location_available", "Address or service-area context is available.", "Confirm address or service-area context before rendering a location panel."),
    {
      id: "contact_hours_policy",
      severity: hoursSeverity,
      detail: bundle.businessProfile.hours || hoursFacts.length ? "Hours are available." : "Hours are unavailable; section must use call-to-confirm language.",
      recommendedAction: "Do not block legitimate businesses for missing hours, but never imply known hours without evidence.",
      affectedSectionId: section.id,
      evidenceFactIds: hoursFacts.map((fact) => fact.id)
    }
  ].map((finding) => ({
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
  version: SiteVersionV3;
  createdAt?: string;
}): SiteArtifactRecord {
  const payload = { payloadVersion: "design-section-audit-v3", report: input.report };
  const contentHash = hashPayload(payload);
  return {
    id: `artifact_${input.siteId}_${input.report.skillId.replace(/[^a-z0-9]+/g, "_")}_${contentHash.slice(0, 16)}`,
    siteId: input.siteId,
    scope: "site_alternative",
    artifactType: "design_section_audit_report",
    artifactVersion: "design-section-audit-v3",
    producerId: input.report.skillId,
    producerVersion: "direct-module-v1",
    sourceFactIds: Array.from(new Set(input.report.findings.flatMap((finding) => finding.evidenceFactIds))),
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

function firstSection(pages: PageV3[], predicate: (section: SectionV3) => boolean) {
  for (const page of pages) {
    const section = page.sections.find(predicate);
    if (section) return section;
  }
  return undefined;
}

function durableFacts(facts: SourceAwareFactV2[], kind: SourceAwareFactV2["kind"]) {
  return facts.filter((fact) => fact.kind === kind && fact.renderPolicy === "durable_render" && fact.sourcePolicy === "durable_render");
}

function textValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(textValues);
  return [];
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
