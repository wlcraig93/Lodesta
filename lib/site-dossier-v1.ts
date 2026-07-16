import { createHash } from "node:crypto";
import type { CrawlAssessment } from "./crawler";
import { testimonialEvidenceItemsV1, trustEvidenceItemsV1 } from "./evidence-ledger-v1";
import { registerForVertical } from "./generated-site-v3-art-direction-catalog";
import type { BrandExpressionVoiceRegisterV1, BusinessProfile, BusinessUnderstandingV2, GeneratedCopyVoiceProfileV2, PublicPresenceSignal, SiteBundle, Vertical } from "./models";

export const siteDossierVersionV1 = "site-dossier-v1" as const;

export type SiteDossierSectionV1 = {
  id: string;
  title: string;
  body: string;
};

export type SiteDossierReviewEvidenceV1 = {
  provider: PublicPresenceSignal["provider"];
  source: PublicPresenceSignal["source"];
  rating?: number;
  count?: number;
  confidence: number;
  notes: string[];
  renderPolicy: "internal_positioning_only";
};

export type SiteDossierCopyBriefV1 = {
  version: "site-dossier-copy-brief-v1";
  policyHash: string;
  voiceProfile: GeneratedCopyVoiceProfileV2;
  voiceGuidance: string;
  proofHierarchy: string[];
  ctaTermFamily: {
    primaryNoun: string;
    primaryActions: string[];
    secondaryActions: string[];
    avoid: string[];
  };
  sectionIntents: Array<{
    id: string;
    role: string;
    point: string;
    proofToUse: string;
    avoid: string;
  }>;
  instructions: string[];
};

export type SiteDossierV1 = {
  version: typeof siteDossierVersionV1;
  producerId: "compose-site-dossier-v1";
  producerVersion: typeof siteDossierVersionV1;
  modelId: "deterministic";
  createdAt: string;
  inputHashes: {
    businessProfile: string;
    crawlEvidence?: string;
    publicPresence?: string;
    businessUnderstanding?: string;
    brandEvidence?: string;
    evidenceLedger?: string;
    siteDirectorPlan?: string;
  };
  stale: boolean;
  sourcePageCount: number;
  proseCharCount: number;
  reviewEvidence: SiteDossierReviewEvidenceV1[];
  copyBrief: SiteDossierCopyBriefV1;
  sections: SiteDossierSectionV1[];
  markdown: string;
  contentHash: string;
};

const dossierMarkdownMaxChars = 12_000;

const dossierCopyPolicy: {
  voiceRules: string[];
  verticalPlaybooks: Partial<Record<Vertical, string[]>>;
  ctaLexicon: Partial<Record<Vertical, { primary: string[]; secondary: string[]; avoid: string[] }>>;
  antiExamples: string[];
} = {
  voiceRules: [
    "Use direct business voice: first-person plural when the source supports a shop/team, otherwise concise brand-direct language.",
    "Never open hero copy with 'At {Business}, we...'. Lead with the customer problem, visible work, or source-backed proof.",
    "Do not invent offers, credentials, warranties, prices, reviews, turnaround times, years in business, or insurance relationships.",
    "Reserve intake instructions for contact/CTA moments; service, process, and proof copy should describe the work and customer decision."
  ],
  verticalPlaybooks: {
    auto_body: [
      "Use concrete collision, paint, panel, dent, glass, estimate, repair, and pickup language.",
      "Process copy should distinguish inspection, estimate/claim decision, repair/refinish work, quality check, and pickup.",
      "Proof copy must only imply real completed repair work when first-party/protected-preview proof media or source facts support it."
    ],
    auto_services: [
      "Use concrete maintenance, inspection, diagnostics, tire, brake, oil, alignment, battery, and scheduling language.",
      "Avoid body-shop collision language unless present in the source."
    ]
  },
  ctaLexicon: {
    auto_body: {
      primary: ["estimate", "repair estimate", "quote"],
      secondary: ["call", "photos", "timing"],
      avoid: ["booking", "reservation", "order"]
    },
    auto_services: {
      primary: ["service", "appointment", "estimate"],
      secondary: ["call", "visit", "timing"],
      avoid: ["reservation", "order"]
    }
  },
  antiExamples: [
    "At {Business}, we are here to help.",
    "Ready to get started?",
    "Clear next steps for focused help.",
    "Use this site to learn about our services.",
    "Contact us with your details and we will get back to you."
  ]
};

const dossierCopyPolicyHash = hashStable(dossierCopyPolicy);

export function composeSiteDossierV1(input: { bundle: SiteBundle; crawl?: CrawlAssessment }): SiteDossierV1 {
  const bundle = input.bundle;
  const business = bundle.businessProfile;
  const assessment = bundle.presenceAssessment;
  const pages = input.crawl?.pageSummaries ?? [];
  const proseCharCount = pages.reduce((total, page) => total + (page.mainText?.length ?? 0), 0);
  const reviewEvidence = reviewEvidenceForDossier(assessment.publicPresenceSignals ?? []);
  const sourceEvidence = assessment.evidenceLedgerV1?.items ?? [];
  const copyBrief = buildSiteDossierCopyBriefV1(bundle);
  const sections = [
    section("identity", "Identity", [
      line("Name", business.name),
      line("Vertical", business.vertical),
      line("Categories", business.categories.join(", ")),
      line("Location", [business.address?.city, business.address?.region].filter(Boolean).join(", ")),
      line("Primary phone", business.phone ? "present" : "missing"),
      line("Hours", business.hours ? `${Object.keys(business.hours).length} entries` : "missing")
    ]),
    section("source-pages", "Crawled Pages", pages.slice(0, 12).map((page) =>
      [
        `- ${pagePurposeTags(page).join(", ")}: ${page.title ?? page.url}`,
        page.mainText ? indent(clampText(page.mainText, 700)) : "  No retained prose."
      ].join("\n")
    )),
    section("facts", "Fact Spine Inputs", [
      line("Services", business.services.join(", ")),
      line("Service areas", business.serviceAreas.join(", ")),
      line("Social links", business.socialLinks.length ? `${business.socialLinks.length} link(s)` : "none"),
      line("Booking links", business.bookingLinks.length ? `${business.bookingLinks.length} link(s)` : "none"),
      line("Fact graph", assessment.businessFactGraph ? `${assessment.businessFactGraph.facts.length} facts` : "not yet composed")
    ]),
    section("understanding", "Business Understanding", [
      line("Detected vertical", assessment.businessUnderstanding?.vertical),
      line("Subverticals", assessment.businessUnderstanding?.detectedSubverticals.join(", ")),
      line("Cleaned services", assessment.businessUnderstanding?.cleanedServices.map((service) => service.name).join(", ")),
      line("Story", assessment.businessUnderstanding?.businessStory?.summary),
      line("Urgent signals", assessment.businessUnderstanding?.urgentServiceSignals.join(", "))
    ]),
    section("presence", "Public Presence Evidence", [
      ...(assessment.publicPresenceNotes.length ? assessment.publicPresenceNotes.map((note) => `- ${note}`) : ["- No public presence notes."]),
      ...reviewEvidence.map((evidence) =>
        `- ${evidence.provider} ${evidence.source}: rating ${evidence.rating ?? "n/a"}, count ${evidence.count ?? "n/a"}; internal positioning only.`
      )
    ]),
    section("source-evidence", "Source Evidence Ledger", [
      ...sourceEvidence
        .filter((item) => item.domain === "business_proof")
        .slice(0, 20)
        .map((item) =>
          `- ${item.kind}: ${item.value.text} [${item.renderPolicy}; ${item.source.type}; ${item.source.url ?? "no URL"}; evidence ${item.id}]`
        ),
      ...sourceEvidence
        .filter((item) => item.domain === "brand")
        .slice(0, 12)
        .map((item) =>
          `- brand/${item.kind}: ${item.value.text} [${item.source.type}; ${item.source.url ?? "render inspection"}; evidence ${item.id}]`
        )
    ]),
    section("brand-assets", "Brand And Asset Evidence", [
      line("Logo", business.logo ? `${business.logo.source}/${business.logo.rightsStatus}` : "missing"),
      line("Photos", `${business.photos.length} profile photo(s)`),
      line("Scraped media", assessment.scrapedMediaManifest?.length ? `${assessment.scrapedMediaManifest.length} protected asset(s)` : "none"),
      line("Brand colors", assessment.brandCueReport?.cues.map((cue) => cue.hex).join(", ")),
      ...assessment.brandNotes.map((note) => `- ${note}`)
    ]),
    section("operator-notes", "Operator Notes", [
      ...assessment.technicalNotes.map((note) => `- Technical: ${note}`),
      ...assessment.visualNotes.map((note) => `- Visual: ${note}`)
    ])
  ].filter((entry) => entry.body.trim().length > 0);

  const rawMarkdown = sections.map((entry) => `## ${entry.title}\n\n${entry.body.trim()}`).join("\n\n");
  const markdown = clampText(rawMarkdown, dossierMarkdownMaxChars);
  const inputHashes = {
    businessProfile: hashStable(business),
    ...(input.crawl ? { crawlEvidence: hashStable(input.crawl.pageSummaries) } : {}),
    ...(assessment.publicPresenceSignals ? { publicPresence: hashStable(assessment.publicPresenceSignals) } : {}),
    ...(assessment.businessUnderstanding ? { businessUnderstanding: hashStable(assessment.businessUnderstanding) } : {}),
    brandEvidence: hashStable({
      brandCueReport: assessment.brandCueReport,
      brandNotes: assessment.brandNotes,
      assetInventory: assessment.assetInventory,
      scrapedMediaManifest: assessment.scrapedMediaManifest
    }),
    ...(assessment.evidenceLedgerV1 ? { evidenceLedger: hashStable(assessment.evidenceLedgerV1) } : {}),
    ...(assessment.siteDirectorPlanV1 ? { siteDirectorPlan: hashStable(assessment.siteDirectorPlanV1.plan) } : {})
  };
  return {
    version: siteDossierVersionV1,
    producerId: "compose-site-dossier-v1",
    producerVersion: siteDossierVersionV1,
    modelId: "deterministic",
    createdAt: new Date().toISOString(),
    inputHashes,
    stale: false,
    sourcePageCount: pages.length,
    proseCharCount,
    reviewEvidence,
    copyBrief,
    sections,
    markdown,
    contentHash: hashStable({ inputHashes, markdown, copyBrief })
  };
}

export function refreshSiteDossierCopyBriefV1(bundle: SiteBundle): SiteDossierV1 {
  const existing = bundle.presenceAssessment.siteDossierV1 ?? composeSiteDossierV1({ bundle });
  const copyBrief = buildSiteDossierCopyBriefV1(bundle);
  const inputHashes = {
    ...existing.inputHashes,
    ...(bundle.presenceAssessment.siteDirectorPlanV1
      ? { siteDirectorPlan: hashStable(bundle.presenceAssessment.siteDirectorPlanV1.plan) }
      : {})
  };
  return {
    ...existing,
    createdAt: new Date().toISOString(),
    stale: false,
    inputHashes,
    copyBrief,
    contentHash: hashStable({ inputHashes, markdown: existing.markdown, copyBrief })
  };
}

export function buildSiteDossierCopyBriefV1(bundle: SiteBundle): SiteDossierCopyBriefV1 {
  const business = bundle.businessProfile;
  const understanding = bundle.presenceAssessment.businessUnderstanding;
  const lexicon = dossierCopyPolicy.ctaLexicon[business.vertical] ?? {
    primary: ["estimate", "consultation", "service"],
    secondary: ["call", "contact", "timing"],
    avoid: ["order", "reservation"]
  };
  const acceptedPlan = bundle.presenceAssessment.siteDirectorPlanV1?.validation.status === "passed"
    ? bundle.presenceAssessment.siteDirectorPlanV1.plan
    : undefined;
  return {
    version: "site-dossier-copy-brief-v1",
    policyHash: dossierCopyPolicyHash,
    voiceProfile: voiceProfileForCopyBrief(
      business,
      bundle.presenceAssessment.ownerDesignSystemEditsV1?.voiceRegister ?? understanding?.brandExpression?.voiceRegister
    ),
    voiceGuidance: voiceGuidanceForCopyBrief(
      business,
      understanding,
      bundle.presenceAssessment.ownerDesignSystemEditsV1?.voiceRegister
    ),
    proofHierarchy: proofHierarchyForCopyBrief(bundle, business, understanding),
    ctaTermFamily: {
      primaryNoun: lexicon.primary[0] ?? "estimate",
      primaryActions: lexicon.primary,
      secondaryActions: lexicon.secondary,
      avoid: lexicon.avoid
    },
    sectionIntents: (acceptedPlan?.home.sections ?? []).map((section) => ({
      id: section.id,
      role: section.role,
      point: section.copyJob?.point ?? section.copyJobId ?? section.role,
      proofToUse: section.copyJob?.proofToUse ?? "",
      avoid: section.copyJob?.avoid ?? ""
    })),
    instructions: [
      ...dossierCopyPolicy.voiceRules,
      ...(dossierCopyPolicy.verticalPlaybooks[business.vertical] ?? []),
      ...dossierCopyPolicy.antiExamples,
      ...lexicon.avoid.map((term) => `Avoid CTA term: ${term}`)
    ]
  };
}

function voiceProfileForCopyBrief(
  business: Pick<BusinessProfile, "vertical">,
  voiceRegister?: BrandExpressionVoiceRegisterV1
): GeneratedCopyVoiceProfileV2 {
  const register = voiceRegister === "warm" || voiceRegister === "premium"
    ? "warm_boutique"
    : voiceRegister === "direct" && business.vertical === "auto_services"
      ? "punchy_retail"
      : registerForVertical(business.vertical);
  switch (business.vertical) {
    case "beauty_salon":
    case "med_spa":
    case "creative_studio":
      return { pov: "brand_direct", register };
    default:
      return { pov: "first_plural", register };
  }
}

function voiceGuidanceForCopyBrief(
  business: BusinessProfile,
  understanding: BusinessUnderstandingV2 | undefined,
  ownerVoiceRegister?: BrandExpressionVoiceRegisterV1
) {
  const profile = voiceProfileForCopyBrief(
    business,
    ownerVoiceRegister ?? understanding?.brandExpression?.voiceRegister
  );
  const relationship = understanding?.businessStory
    ? "Use a warm business voice grounded in the source story."
    : business.categories.some((category) => /shop|repair|service/i.test(category))
      ? "Use a direct shop voice."
      : "Use plainspoken, locally specific language.";
  const register = (() => {
    switch (profile.register) {
      case "punchy_retail":
        return "Use short declarative headlines, energetic rhythm, and verbs over adjectives without inventing claims.";
      case "warm_boutique":
        return "Use inviting, sensory, unhurried language without turning the page into a pitch.";
      default:
        return "Use a clear, calm, competence-forward register with no hype.";
    }
  })();
  return `${relationship} ${register}`;
}

function proofHierarchyForCopyBrief(bundle: SiteBundle, business: BusinessProfile, understanding: BusinessUnderstandingV2 | undefined) {
  const testimonials = testimonialEvidenceItemsV1(bundle.presenceAssessment.evidenceLedgerV1);
  const trustEvidence = trustEvidenceItemsV1(bundle.presenceAssessment.evidenceLedgerV1);
  return [
    testimonials.length ? `${testimonials.length} source-backed first-party testimonial${testimonials.length === 1 ? "" : "s"}` : undefined,
    ...trustEvidence.map((item) => `${item.kind}: ${item.value.text}`),
    understanding?.businessStory ? "source business story" : undefined,
    business.serviceHighlights?.length ? "service highlights" : undefined,
    business.reviewsSummary ? "review summary" : undefined,
    business.hours ? "published hours" : undefined,
    business.address?.city ? "local address/service area" : undefined,
    business.services.length ? "service list" : undefined
  ].filter(Boolean) as string[];
}

function reviewEvidenceForDossier(signals: PublicPresenceSignal[]): SiteDossierReviewEvidenceV1[] {
  return signals
    .filter((signal) => signal.fields.rating !== undefined || signal.fields.userRatingCount !== undefined)
    .map((signal) => ({
      provider: signal.provider,
      source: signal.source,
      rating: signal.fields.rating,
      count: signal.fields.userRatingCount,
      confidence: signal.confidence,
      notes: signal.notes,
      renderPolicy: "internal_positioning_only"
    }));
}

function pagePurposeTags(page: CrawlAssessment["pageSummaries"][number]) {
  const tags = (page as { purposeTags?: string[] }).purposeTags;
  return tags?.length ? tags : ["other"];
}

function section(id: string, title: string, lines: Array<string | undefined>): SiteDossierSectionV1 {
  return {
    id,
    title,
    body: lines.filter((line): line is string => Boolean(line && line.trim())).join("\n")
  };
}

function line(label: string, value: string | undefined) {
  if (!value) return undefined;
  return `- ${label}: ${value}`;
}

function indent(value: string) {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function clampText(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, maxChars).trimEnd()}...` : value;
}

function hashStable(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableStringify);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortForStableStringify(entryValue)])
  );
}
