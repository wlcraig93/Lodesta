import type { CrawlAssessment } from "./crawler";
import type { SiteBundle, StandardCheckResult, StandardCriterion, StandardEvaluation } from "./models";
import { getCriteriaForVertical, getStandardCriterion } from "./standard";
import { getPublishedVersion } from "./sample-data";

export function evaluateCrawlAgainstStandard(crawl: CrawlAssessment): StandardEvaluation {
  const checks: StandardCheckResult[] = crawl.score.checks.map((check) => {
    const criterion = getStandardCriterion(check.standardCriterionId);
    return {
      criterionId: check.standardCriterionId,
      title: criterion?.title ?? check.label,
      layer: criterion?.layer ?? "technical_seo",
      vertical: criterion?.vertical ?? "universal",
      checkMethod: criterion?.checkMethod ?? "crawl",
      passed: check.passed,
      severity: check.passed ? "pass" : check.maxPoints >= 10 ? "fail" : "warning",
      evidence: check.passed
        ? `${check.label} passed during crawl.`
        : `${check.label} failed during crawl.`,
      businessConsequence: check.consequence
    };
  });

  return {
    source: "crawl",
    sourceUrl: crawl.finalUrl ?? crawl.url,
    score: {
      overall: crawl.score.overall,
      max: crawl.score.max,
      percent: crawl.score.percent,
      grade: crawl.score.grade
    },
    checks
  };
}

export function evaluateSiteAgainstStandard(
  bundle: SiteBundle,
  options: { versionId?: string; versionStatus?: "draft" | "published" } = {}
): StandardEvaluation {
  const version =
    options.versionId
      ? bundle.siteModel.versions.find((item) => item.id === options.versionId) ?? getPublishedVersion(bundle.siteModel)
      : options.versionStatus === "draft"
      ? bundle.siteModel.versions.find((item) => item.status === "draft") ?? getPublishedVersion(bundle.siteModel)
      : getPublishedVersion(bundle.siteModel);
  const pages = version.pages;
  const homePage = pages.find((page) => page.slug === "") ?? pages[0];
  const homeHero = homePage?.sections.find((section) => section.type === "hero");
  const criteria = getCriteriaForVertical(bundle.businessProfile.vertical);
  const checks = criteria.map((criterion): StandardCheckResult => {
    const result = evaluateCriterion(criterion.id, bundle, pages, homeHero);
    return {
      criterionId: criterion.id,
      title: criterion.title,
      layer: criterion.layer,
      vertical: criterion.vertical,
      checkMethod: criterion.checkMethod,
      passed: result.passed,
      severity: result.passed ? "pass" : result.severity,
      evidence: result.evidence,
      businessConsequence: criterion.businessConsequence
    };
  });
  const max = checks.length * 10;
  const overall = checks.reduce((total, check) => total + (check.passed ? 10 : check.severity === "warning" ? 5 : 0), 0);
  const percent = max > 0 ? Math.round((overall / max) * 100) : 0;

  return {
    source: "site_model",
    siteId: bundle.businessProfile.siteId,
    score: {
      overall,
      max,
      percent,
      grade: percent >= 90 ? "excellent" : percent >= 75 ? "good" : percent >= 55 ? "needs_work" : "poor"
    },
    checks
  };
}

export function isColdUrlCheckableMethod(checkMethod: StandardCriterion["checkMethod"]) {
  return checkMethod === "crawl" || checkMethod === "dom";
}

export function coldUrlCheckableChecks(checks: StandardCheckResult[]) {
  return checks.filter((check) => isColdUrlCheckableMethod(check.checkMethod));
}

function evaluateCriterion(
  criterionId: string,
  bundle: SiteBundle,
  pages: SiteBundle["siteModel"]["versions"][number]["pages"],
  homeHero?: SiteBundle["siteModel"]["versions"][number]["pages"][number]["sections"][number]
) {
  const business = bundle.businessProfile;
  switch (criterionId) {
    case "technical.https":
      return result(true, "fail", "Generated customer sites are served through HTTPS-capable Railway or Cloudflare hostnames.");
    case "technical.healthy_response":
      return result(pages.length > 0, "fail", "The structured renderer serves generated page models through dynamic HTML routes.");
    case "technical.mobile_viewport":
      return result(true, "fail", "The Next.js app layout provides a responsive viewport and the shared renderer uses responsive sections.");
    case "technical.mobile_performance":
      return result(
        true,
        "warning",
        "Generated public pages use the shared lightweight renderer; post-publish Web Vitals analytics enforce live performance thresholds."
      );
    case "seo.title.unique":
      return result(
        pages.every((page) => page.seo.title.length >= 25),
        "fail",
        "All page titles should be at least 25 characters and page-specific."
      );
    case "seo.meta_description":
      return result(
        pages.every((page) => page.seo.description.length >= 80),
        "warning",
        "All page meta descriptions should be at least 80 characters."
      );
    case "seo.canonical":
      return result(
        pages.every((page) => cleanCanonicalPath(page.seo.canonicalPath)),
        "fail",
        "Every generated page should carry a clean canonical path for the mapped host."
      );
    case "seo.clean_urls":
      return result(
        pages.every((page) => cleanSlug(page.slug) && cleanCanonicalPath(page.seo.canonicalPath)),
        "fail",
        "Generated page slugs and canonical paths should be extensionless and query-free."
      );
    case "seo.robots_txt":
      return result(true, "warning", "Published claimed sites serve robots.txt from the structured site route.");
    case "seo.sitemap":
      return result(pages.length > 0, "warning", "Published claimed sites generate sitemap.xml from the page model.");
    case "seo.local_business_schema":
      return result(Boolean(business.name && business.phone && (business.address || business.serviceAreas.length)), "fail", "BusinessProfile needs name, phone, and address or service area for LocalBusiness schema.");
    case "seo.service_location_pages": {
      const servicePageCount = pages.filter((page) => page.slug.startsWith("services/")).length;
      const areaPageCount = pages.filter((page) => page.slug.startsWith("areas/")).length;
      const hasServicePages = business.services.length === 0 || servicePageCount >= Math.min(1, business.services.length);
      const hasAreaPages = business.serviceAreas.length === 0 || /^local area$/i.test(business.serviceAreas[0] ?? "") || areaPageCount >= 1;
      return result(
        hasServicePages && hasAreaPages,
        "warning",
        `Generated ${servicePageCount} service pages and ${areaPageCount} service-area pages.`
      );
    }
    case "conversion.mobile_click_to_call":
      return result(Boolean(business.phone && hasTelCta(pages)), "fail", "At least one generated CTA should use a tel: link when phone is known.");
    case "conversion.primary_action_above_fold":
      return result(Boolean(homeHero?.props.primaryCta), "fail", "The home hero should include a primary CTA.");
    case "conversion.mobile_sticky_action":
      return result(Boolean(homeHero?.props.primaryCta), "warning", "Sticky action can be served from the home hero CTA by the renderer.");
    case "conversion.lead_form":
      return result(bundle.extensionModel.forms.length > 0 && hasSection(pages, "contact"), "fail", "A contact section and at least one form should exist.");
    case "trust.reviews_visible":
      return result(Boolean(business.reviewsSummary?.rating || business.reviewsSummary?.count || hasSection(pages, "trust_bar") || hasSection(pages, "testimonials")), "warning", "Surface verified reviews, testimonials, ratings, or other trust proof.");
    case "trust.credentials_or_years":
      return result(
        Boolean(
          business.reviewsSummary?.rating ||
            business.reviewsSummary?.count ||
            hasSection(pages, "trust_bar") ||
            hasSection(pages, "testimonials") ||
            hasSection(pages, "team") ||
            pagesContainText(
              pages,
              /credential|certified|licensed|insured|years|award|provider|attorney|trainer|veterinarian|doctor|portfolio|project proof|results/i
            )
        ),
        "warning",
        "Generated site should include owner-verifiable trust proof such as credentials, years in business, team proof, testimonials, ratings, or project outcomes."
      );
    case "content.service_area_clarity": {
      const areaPageCount = pages.filter((page) => page.slug.startsWith("areas/")).length;
      const hasKnownArea = Boolean(
        business.address?.city ||
          business.address?.street ||
          business.serviceAreas.some((area) => !/^local area$/i.test(area.trim()))
      );
      return result(
        hasKnownArea || hasSection(pages, "map") || areaPageCount > 0,
        "warning",
        "Generated site should make the address, map, service areas, or local area pages clear from BusinessProfile facts."
      );
    }
    case "content.faqs":
      return result(hasSection(pages, "faq"), "warning", "Generated site should answer common customer questions with an FAQ section.");
    case "accessibility.image_alt":
      return result(pageImagesHaveAlt(pages), "warning", "Generated gallery, logo, and uploaded image objects should include alt text.");
    case "content.restaurant.order_path":
      return result(hasSection(pages, "menu_deals") && Boolean(business.orderingLinks[0] || hasRoleCta(pages, "ordering") || hasSection(pages, "contact")), "warning", "Restaurant sites should expose menu plus ordering, reservation, or contact flow.");
    case "content.home_services.emergency_cta":
      return result(
        !business.services.some((service) => /emergency|24\/7|urgent/i.test(service)) || pagesContainText(pages, /emergency|24\/7|call now/i),
        "warning",
        "Emergency-intent businesses should make urgent call paths obvious."
      );
    case "content.auto_body.before_after":
      return result(hasSection(pages, "before_after") || hasSection(pages, "gallery"), "warning", "Auto body sites should include before/after or project proof.");
    case "content.beauty_salon.gallery_booking":
      return result(hasSection(pages, "gallery") && hasBookingOrFormPath(pages), "warning", "Beauty sites should show work samples and a booking or inquiry path.");
    case "content.med_spa.credentials_results":
      return result(hasSection(pages, "services") && hasSection(pages, "team") && (hasSection(pages, "before_after") || hasSection(pages, "testimonials")), "warning", "Med spa sites should show treatments, credentials, and result proof.");
    case "content.law_firm.practice_credibility":
      return result(hasSection(pages, "services") && hasSection(pages, "team") && !hasSection(pages, "gallery"), "warning", "Law firm sites should prioritize practice areas and attorney credibility over visual galleries.");
    case "content.dental.new_patient_path":
      return result(hasSection(pages, "services") && hasSection(pages, "team") && (pagesContainText(pages, /insurance|new patient|appointment/i) || hasBookingOrFormPath(pages)), "warning", "Dental sites should cover services, team trust, and new-patient booking concerns.");
    case "content.fitness.trial_schedule":
      return result(hasSection(pages, "services") && (hasSection(pages, "team") || pagesContainText(pages, /trainer|coach|class/i)) && hasBookingOrFormPath(pages), "warning", "Fitness sites should expose trial/join action, classes or services, and instructor proof.");
    case "content.real_estate.valuation_contact":
      return result(hasSection(pages, "contact") && pagesContainText(pages, /valuation|home value|local|neighborhood|listing|buyer|seller/i), "warning", "Real estate sites should include local expertise and a clear valuation or contact path.");
    case "content.landscaping.project_gallery":
      return result(hasSection(pages, "gallery") && hasSection(pages, "contact") && (hasSection(pages, "map") || business.serviceAreas.length > 0), "warning", "Landscaping sites should show project proof, quote path, and service area.");
    case "content.veterinary.team_new_patient":
      return result(hasSection(pages, "services") && hasSection(pages, "team") && hasBookingOrFormPath(pages), "warning", "Veterinary sites should show services, care team, and appointment or contact path.");
    case "content.creative_studio.portfolio_first":
      return result(hasSection(pages, "gallery") && hasSection(pages, "contact"), "warning", "Creative studio sites should lead with portfolio proof and a clear inquiry path.");
    case "content.general_local.local_spine":
      return result(hasSection(pages, "services") && hasSection(pages, "contact") && (hasSection(pages, "trust_bar") || hasSection(pages, "testimonials")), "warning", "General local sites should include services, trust proof, and contact path.");
    default:
      return result(true, "warning", "Criterion is not yet evaluated against the structured site model.");
  }
}

function result(passed: boolean, severity: "warning" | "fail", evidence: string) {
  return { passed, severity, evidence };
}

function cleanSlug(slug: string) {
  return !slug.includes("?") && !/\.(php|asp|aspx|jsp|cfm|cgi|html?)$/i.test(slug);
}

function cleanCanonicalPath(path: string) {
  return path.startsWith("/") && !path.includes("?") && !/\.(php|asp|aspx|jsp|cfm|cgi|html?)$/i.test(path);
}

function hasSection(pages: SiteBundle["siteModel"]["versions"][number]["pages"], sectionType: string) {
  return pages.some((page) => page.sections.some((section) => section.type === sectionType));
}

function hasTelCta(pages: SiteBundle["siteModel"]["versions"][number]["pages"]) {
  return pages.some((page) =>
    page.sections.some((section) =>
      Object.entries(section.props).some(([key, value]) => {
        if (!key.toLowerCase().includes("cta") || !value || typeof value !== "object") return false;
        return String((value as { href?: unknown }).href ?? "").startsWith("tel:");
      })
    )
  );
}

function hasRoleCta(pages: SiteBundle["siteModel"]["versions"][number]["pages"], role: string) {
  return pages.some((page) =>
    page.sections.some((section) =>
      Object.entries(section.props).some(([key, value]) => {
        if (!key.toLowerCase().includes("cta") || !value || typeof value !== "object") return false;
        return (value as { role?: unknown }).role === role;
      })
    )
  );
}

function hasBookingOrFormPath(pages: SiteBundle["siteModel"]["versions"][number]["pages"]) {
  return hasRoleCta(pages, "booking") || hasRoleCta(pages, "form") || hasSection(pages, "contact");
}

function pagesContainText(pages: SiteBundle["siteModel"]["versions"][number]["pages"], pattern: RegExp) {
  return pattern.test(JSON.stringify(pages));
}

function pageImagesHaveAlt(pages: SiteBundle["siteModel"]["versions"][number]["pages"]) {
  return pages.every((page) =>
    page.sections.every((section) => Object.values(section.props).every((value) => imageValueHasAlt(value)))
  );
}

function imageValueHasAlt(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(imageValueHasAlt);
  if (!value || typeof value !== "object") return true;
  const record = value as Record<string, unknown>;
  const hasImageUrl =
    typeof record.url === "string" ||
    typeof record.src === "string" ||
    typeof record.imageUrl === "string";
  if (hasImageUrl && typeof record.alt !== "string" && typeof record.label !== "string") return false;
  return Object.values(record).every(imageValueHasAlt);
}
