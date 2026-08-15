import type { CrawlAssessment, CrawlPagePurposeTag, CrawlPageSummary } from "@/lib/crawler";
import type { WebsiteGenerationIngestion } from "@/packages/business-data/generation-crawler";
import type { SiteBuildArtifact, SitePublicBuildInput } from "@/packages/site-contracts";
import type { WebsiteSiteInventory } from "./contracts";

type SitePageType = WebsiteSiteInventory["pageTypes"][number]["id"];

const pageTypeLabels: Record<SitePageType, string> = {
  home: "Homepage",
  service: "Service pages",
  location: "Location pages",
  about: "About pages",
  contact: "Contact pages",
  faq: "FAQ pages",
  proof: "Proof and case studies",
  comparison: "Comparison pages",
  editorial: "Articles and resources",
  legal: "Legal pages",
  other: "Other pages"
};

export function siteInventoryForPublicUrl(input: {
  crawl: CrawlAssessment;
  ingestion: WebsiteGenerationIngestion;
}): WebsiteSiteInventory {
  const pages = input.crawl.pageSummaries;
  const substantivePages = pages.filter((page) => pageContentLength(page) >= 500).length;
  const thinPages = pages.filter((page) => {
    const length = pageContentLength(page);
    return length > 0 && length < 250 && primaryCrawlPageType(page) !== "legal";
  }).length;
  const unclassifiedPages = Math.max(
    0,
    input.ingestion.counts.fetched - substantivePages - thinPages
  );
  return {
    source: "complete_crawl",
    coverage: input.ingestion.coverage,
    discoveredUrls: input.ingestion.counts.discovered,
    eligiblePages: input.ingestion.counts.eligible,
    assessedPages: input.ingestion.counts.fetched,
    failedPages: input.ingestion.counts.failed,
    contentDepth: {
      substantivePages,
      thinPages,
      unclassifiedPages
    },
    pageTypes: pageTypeRows(pages.map(primaryCrawlPageType))
  };
}

export function siteInventoryForArtifact(input: {
  artifact: SiteBuildArtifact;
  buildInput: SitePublicBuildInput;
}): WebsiteSiteInventory {
  const purposeByRoute = new Map(input.buildInput.intent.pageRequirements.map((requirement) => [
    requirement.slug ? `/${requirement.slug}` : "/",
    requirement.purpose
  ]));
  const routeTypes = input.artifact.routes.map((route) =>
    primaryArtifactPageType({
      path: route.path,
      title: route.title,
      purpose: purposeByRoute.get(route.path)
    })
  );
  return {
    source: "retained_artifact",
    coverage: "retained_artifact",
    discoveredUrls: input.artifact.routes.length,
    eligiblePages: input.artifact.routes.length,
    assessedPages: input.artifact.qa.routesChecked,
    failedPages: input.artifact.qa.findings.filter((finding) =>
      finding.severity === "error" && Boolean(finding.route)
    ).length,
    contentDepth: {
      substantivePages: 0,
      thinPages: 0,
      unclassifiedPages: input.artifact.routes.length
    },
    pageTypes: pageTypeRows(routeTypes)
  };
}

function primaryCrawlPageType(page: CrawlPageSummary): SitePageType {
  return primaryPageType(page.purposeTags, page.url, page.title);
}

function primaryArtifactPageType(input: {
  path: string;
  title: string;
  purpose?: string;
}): SitePageType {
  const purpose = input.purpose?.toLowerCase() ?? "";
  if (purpose === "home") return "home";
  if (purpose === "service") return "service";
  if (purpose === "location") return "location";
  if (purpose === "contact") return "contact";
  if (purpose === "about") return "about";
  return primaryPageType([], input.path, input.title);
}

function primaryPageType(
  tags: CrawlPagePurposeTag[],
  route: string,
  title?: string
): SitePageType {
  if (tags.includes("home")) return "home";
  if (tags.includes("comparison")) return "comparison";
  if (tags.includes("service_detail") || tags.includes("services")) return "service";
  if (tags.includes("location")) return "location";
  if (tags.includes("contact")) return "contact";
  if (tags.includes("about")) return "about";
  if (tags.includes("faq")) return "faq";
  if (tags.some((tag) => ["reviews", "gallery", "case_study"].includes(tag))) return "proof";
  if (tags.includes("blog")) return "editorial";
  if (tags.includes("legal")) return "legal";
  const text = `${route} ${title ?? ""}`.toLowerCase();
  if (/(?:^|\/)(?:compare|comparison|alternatives?|why-choose|versus)(?:\/|$)|\bvs\.?\b/.test(text)) return "comparison";
  if (/case[- ]stud|success[- ]stor|portfolio|projects?|testimonials?|reviews?/.test(text)) return "proof";
  if (/services?|repairs?|treatments?|solutions?/.test(text)) return "service";
  if (/locations?|service[- ]areas?|areas[- ]we[- ]serve/.test(text)) return "location";
  if (/contact|get[- ]in[- ]touch|book|estimate|quote/.test(text)) return "contact";
  if (/about|our[- ]story|team/.test(text)) return "about";
  if (/faq|questions?/.test(text)) return "faq";
  if (/blog|news|articles?|resources?|guides?/.test(text)) return "editorial";
  if (/privacy|terms|accessibility|legal/.test(text)) return "legal";
  return route === "/" ? "home" : "other";
}

function pageContentLength(page: CrawlPageSummary) {
  return page.mainText?.trim().length ?? 0;
}

function pageTypeRows(types: SitePageType[]): WebsiteSiteInventory["pageTypes"] {
  const counts = new Map<SitePageType, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
  return (Object.keys(pageTypeLabels) as SitePageType[]).map((id) => ({
    id,
    label: pageTypeLabels[id],
    count: counts.get(id) ?? 0
  }));
}
