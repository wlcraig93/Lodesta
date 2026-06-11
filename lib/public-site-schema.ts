import type { SiteVersion } from "./models";

/**
 * FAQPage JSON-LD (Phase 4) from the composed FAQ section. LocalBusiness
 * JSON-LD stays canonical in lib/structured-data.ts (provenance-aware,
 * verified fields only) — do not duplicate it here.
 */

export function faqPageJsonLd(version: SiteVersion, pageId: string): Record<string, unknown> | undefined {
  if (version.rendererVersion !== "layout-v3") return undefined;
  const v3 = version as { pageComposition?: { pages: Array<{ id: string; sections: Array<{ props?: { visualSectionV3?: { templateId: string; slots: { items?: { items?: Array<{ question?: string; answer?: string }> } } } } }> }> } };
  const composedPage = v3.pageComposition?.pages.find((candidate) => candidate.id === pageId) ?? v3.pageComposition?.pages[0];
  const faqSection = composedPage?.sections
    .map((section) => section.props?.visualSectionV3)
    .find((visual) => visual?.templateId === "faq_list");
  const items = (faqSection?.slots.items?.items ?? []).filter((item) => item.question && item.answer);
  if (items.length < 2) return undefined;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer }
    }))
  };
}
