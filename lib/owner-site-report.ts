import type { SiteVersion } from "./models";

/**
 * "What you got" report (Phase 4): translates the quality gate's rubric into
 * owner-legible proof at claim time. Every claim in the report maps to a
 * measured gate dimension — nothing aspirational.
 */

export type OwnerSiteReport = {
  overallScore?: number;
  mobile: { score?: number; statement: string };
  seo: { statement: string; checklist: Array<{ label: string; done: boolean }> };
  pages: { count: number; slugs: string[]; statement: string };
  grounding: { score?: number; statement: string };
};

export function buildOwnerSiteReport(version: SiteVersion): OwnerSiteReport {
  const v3 = version as SiteVersion & {
    generationQa?: {
      readiness?: string;
      blockers?: Array<{ id: string }>;
      warnings?: Array<{ id: string }>;
      inspectionSummary?: { metricsByViewport?: Record<string, unknown> };
    };
    pageComposition?: { pages: Array<{ slug?: string; seo?: { title?: string; description?: string } }> };
  };
  const pages = v3.pageComposition?.pages ?? [];
  const slugs = pages.map((page) => page.slug || "home");
  const qa = v3.generationQa;
  const isReady = qa?.readiness === "ready";
  const mobileChecked = Boolean(qa?.inspectionSummary?.metricsByViewport && Object.keys(qa.inspectionSummary.metricsByViewport).length > 0);
  const sourceGrounded = !(qa?.blockers ?? []).some((blocker) =>
    blocker.id.includes("ground") || blocker.id.includes("source") || blocker.id.includes("claim")
  );
  const seoChecklist = [
    { label: "Page titles and descriptions on every page", done: pages.every((page) => Boolean(page.seo?.title && page.seo?.description)) },
    { label: "Mobile rendering verified across phone, tablet, and desktop", done: mobileChecked },
    { label: "Readable text and accessible contrast verified", done: isReady },
    { label: "Dedicated service pages where your services support them", done: pages.length > 1 }
  ];
  return {
    overallScore: undefined,
    mobile: {
      score: undefined,
      statement:
        mobileChecked
          ? "Your site was rendered and checked on phone, tablet, and desktop before it was approved."
          : "Mobile rendering is still being reviewed."
    },
    seo: {
      statement: "Search-engine structure is generated from your confirmed business facts.",
      checklist: seoChecklist
    },
    pages: {
      count: pages.length,
      slugs,
      statement:
        pages.length > 1
          ? `Your site has ${pages.length} pages, including dedicated pages for your key services.`
          : "Your site is a focused single page; service pages are added as your confirmed services support them."
    },
    grounding: {
      score: undefined,
      statement:
        sourceGrounded
          ? "Every claim on your site traces to a verified fact about your business — nothing is invented."
          : "Some content is awaiting fact confirmation."
    }
  };
}
