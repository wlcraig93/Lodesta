import { standardCriteria } from "./standard";
import type { BusinessProfile, OptimizationFinding, SiteModel } from "./models";
import { primaryCtaForBusiness, strongerMetadataForPage } from "./optimization";

export function runAudit(business: BusinessProfile, site: SiteModel): OptimizationFinding[] {
  const version = site.versions.find((item) => item.status === "published") ?? site.versions[0];
  const pages = version.pages;
  const findings: OptimizationFinding[] = [];
  const hasPhone = Boolean(business.phone);
  const hasLocation = Boolean(
    business.address?.city ||
      business.address?.street ||
      business.serviceAreas.some((area) => !/^local area$/i.test(area.trim()))
  );
  const hasReviews = Boolean(business.reviewsSummary?.rating || business.reviewsSummary?.count);
  const hasContactSection = pages.some((page) => page.sections.some((section) => section.type === "contact"));
  const hasFaqSection = hasSection(pages, "faq");
  const hasTrustProof =
    hasReviews ||
    hasSection(pages, "trust_bar") ||
    hasSection(pages, "testimonials") ||
    hasSection(pages, "team") ||
    pagesContainText(
      pages,
      /credential|certified|licensed|insured|years|award|provider|attorney|trainer|veterinarian|doctor|portfolio|project proof|results/i
    );
  const hasServiceAreaClarity = hasLocation || hasSection(pages, "map") || pages.some((page) => page.slug.startsWith("areas/"));
  const homePage = pages.find((page) => page.slug === "") ?? pages[0];
  const homeHero = homePage?.sections.find((section) => section.type === "hero");
  const hasHeroCta = Boolean(homeHero?.props.primaryCta);

  if (!hasPhone) {
    findings.push(makeFinding(business.siteId, "missing_phone", "conversion", "critical", "Phone number is missing", "Mobile callers cannot call from the site.", "Add and verify the main phone number.", "manual_service", "calls", undefined, "conversion.mobile_click_to_call"));
  }

  if (!hasLocation) {
    findings.push(makeFinding(business.siteId, "missing_address", "seo", "critical", "Address or service area is missing", "Local visitors and search engines need location clarity.", "Verify address or service area.", "manual_service", "engaged_sessions", undefined, "seo.local_business_schema"));
  }

  if (!hasServiceAreaClarity) {
    findings.push(makeFinding(business.siteId, "missing_service_area_clarity", "content", "recommended", "Service area is unclear", "Local visitors may not know whether the business serves their area.", "Verify the address, service area, map, or local area pages.", "manual_service", "engaged_sessions", undefined, "content.service_area_clarity"));
  }

  if (!hasContactSection) {
    findings.push(makeFinding(business.siteId, "missing_contact", "conversion", "critical", "Contact path is missing", "Visitors need a clear way to reach the business.", "Add a contact section and form.", "one_click", "forms", {
      action: "add_contact_section",
      pageId: pages[0]?.id ?? "page_home",
      heading: `Contact ${business.name}`,
      formId: "form_contact",
      primaryCta: primaryCtaForBusiness(business)
    }, "conversion.lead_form"));
  }

  if (!hasHeroCta) {
    const hero = homeHero && homePage ? { page: homePage, section: homeHero } : undefined;
    findings.push(makeFinding(business.siteId, "missing_hero_cta", "conversion", "critical", "Primary CTA is missing above the fold", "Visitors do not immediately know what to do next.", "Add a primary CTA to the hero.", "one_click", "calls", hero ? {
      action: "set_hero_cta",
      pageId: hero.page.id,
      sectionId: hero.section.id,
      cta: primaryCtaForBusiness(business)
    } : undefined, "conversion.primary_action_above_fold"));
  }

  if (!hasTrustProof) {
    findings.push(makeFinding(business.siteId, "missing_trust_proof", "trust", "recommended", "Trust proof is weak", "Visitors may hesitate without ratings, testimonials, credentials, years in business, or project proof.", "Add owner-verified reviews, credentials, testimonials, team proof, or project outcomes.", "manual_service", "forms", undefined, "trust.credentials_or_years"));
  } else if (!hasReviews) {
    findings.push(makeFinding(business.siteId, "missing_reviews", "trust", "recommended", "Reviews are not visible", "Visitors may hesitate without ratings or testimonials near conversion paths.", "Add verified review summary or testimonials.", "manual_service", "forms", undefined, "trust.reviews_visible"));
  }

  if (!hasFaqSection) {
    findings.push(makeFinding(business.siteId, "missing_faq", "content", "recommended", "Common customer questions are missing", "Unanswered questions create friction before calls, bookings, orders, or form submissions.", "Add a concise FAQ section using owner-reviewable business facts.", "one_click", "forms", {
      action: "add_faq_section",
      pageId: homePage?.id ?? pages[0]?.id ?? "page_home",
      items: faqItemsForBusiness(business)
    }, "content.faqs"));
  }

  for (const page of pages) {
    if (page.seo.title.length < 25 || page.seo.description.length < 80) {
      findings.push(makeFinding(business.siteId, `weak_meta_${page.id}`, "seo", "recommended", `Weak metadata on ${page.title}`, "Search snippets may underperform.", "Generate a stronger title and meta description.", "auto_fix", "engaged_sessions", {
        action: "update_page_metadata",
        pageId: page.id,
        ...strongerMetadataForPage(business, page)
      }, "seo.title.unique"));
    }
  }

  const matchingCriteria = standardCriteria.filter(
    (criterion) => criterion.vertical === "universal" || criterion.vertical === business.vertical
  );

  if (matchingCriteria.length < 4) {
    findings.push(makeFinding(business.siteId, "thin_standard", "technical", "nice_to_have", "Vertical Standard coverage is thin", "Generation and audits improve as the Standard grows.", "Add more criteria for this vertical.", "manual_service"));
  }

  return findings;
}

function hasSection(pages: SiteModel["versions"][number]["pages"], sectionType: string) {
  return pages.some((page) => page.sections.some((section) => section.type === sectionType));
}

function pagesContainText(pages: SiteModel["versions"][number]["pages"], pattern: RegExp) {
  return pattern.test(JSON.stringify(pages));
}

function faqItemsForBusiness(business: BusinessProfile) {
  const service = business.services[0] || business.categories[0] || "service";
  const area = business.address?.city || business.serviceAreas.find((item) => !/^local area$/i.test(item.trim())) || "the local area";
  return [
    {
      question: `Do you serve ${area}?`,
      answer: `Yes. ${business.name} works with customers in ${area}; confirm your address or service area details during intake.`
    },
    {
      question: `How do I request ${service}?`,
      answer: "Use the contact form or primary call button and include the service you need, timing, and any useful project details."
    },
    {
      question: "Can I verify business details before starting?",
      answer: "Yes. Owner-confirmed phone, location, services, and trust proof should be reviewed before publishing."
    }
  ];
}

function makeFinding(
  siteId: string,
  id: string,
  category: OptimizationFinding["category"],
  severity: OptimizationFinding["severity"],
  title: string,
  rationale: string,
  recommendedAction: string,
  applyMode: OptimizationFinding["applyMode"],
  expectedOutcomeMetric?: OptimizationFinding["expectedOutcomeMetric"],
  suggestedEditPayload?: Record<string, unknown>,
  standardCriterionId?: string
): OptimizationFinding {
  return {
    id,
    siteId,
    standardCriterionId,
    category,
    severity,
    title,
    rationale,
    recommendedAction,
    status: "open",
    applyMode,
    expectedOutcomeMetric,
    suggestedEditPayload
  };
}
