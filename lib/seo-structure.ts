import type { SiteBundle, SiteVersion } from "./models";
import type { VisualSectionV3 } from "./generated-site-v3-visual-controls";
import { makeLocalBusinessJsonLdForBundle } from "./structured-data";
import { faqPageJsonLd } from "./public-site-schema";

/**
 * SEO & structure dimension (scorecard slice 1b) — deterministic checks over
 * the composed version, no browser required. Each check carries a weight;
 * the dimension score is the weighted pass total. Perf proxies are budget
 * checks (image/font counts), not runtime measurements — LCP-class signals
 * stay with render inspection.
 */

export type SeoStructureCheck = {
  id: string;
  weight: number;
  passed: boolean;
  detail: string;
};

export type SeoStructureResult = {
  score: number;
  checks: SeoStructureCheck[];
};

type ComposedPageLike = {
  id: string;
  slug: string;
  title: string;
  purpose: string;
  seo: { title: string; description: string; canonicalPath: string; noIndex?: boolean };
  sections: Array<{ props?: Record<string, unknown> }>;
};

type LooseSlots = {
  media?: { items?: unknown[] };
  items?: { items?: Array<{ href?: string; mediaUrl?: string }> };
};

function visualSections(page: ComposedPageLike): VisualSectionV3[] {
  return page.sections
    .map((section) => (section.props as { visualSectionV3?: VisualSectionV3 } | undefined)?.visualSectionV3)
    .filter((visual): visual is VisualSectionV3 => Boolean(visual));
}

const looseSlots = (visual: VisualSectionV3): LooseSlots => visual.slots as LooseSlots;

export function evaluateSeoStructure(input: { bundle: SiteBundle; version: SiteVersion }): SeoStructureResult {
  const checks: SeoStructureCheck[] = [];
  const version = input.version as SiteVersion & { pageComposition?: { pages: ComposedPageLike[] } };
  const pages = version.pageComposition?.pages ?? [];
  const push = (id: string, weight: number, passed: boolean, detail: string) =>
    checks.push({ id, weight, passed, detail });

  if (!pages.length) {
    return { score: 0, checks: [{ id: "composition_present", weight: 100, passed: false, detail: "No composed pages." }] };
  }

  const businessName = input.bundle.businessProfile.name;

  const titlesOk = pages.every(
    (page) => page.seo.title.length >= 15 && page.seo.title.length <= 70 && page.seo.title.includes(businessName.split(" ")[0])
  );
  push("titles", 15, titlesOk, titlesOk ? "All page titles sized and branded." : "A page title is missing, too short/long, or unbranded.");

  const descriptionsOk = pages.every((page) => page.seo.description.length >= 50 && page.seo.description.length <= 170);
  push("descriptions", 15, descriptionsOk, descriptionsOk ? "All meta descriptions in range." : "A meta description is outside 50-170 chars.");

  const canonicals = pages.map((page) => page.seo.canonicalPath);
  const canonicalsOk = new Set(canonicals).size === canonicals.length && canonicals.every((path) => path.startsWith("/"));
  push("canonicals", 10, canonicalsOk, canonicalsOk ? "Canonical paths unique and rooted." : "Duplicate or malformed canonical paths.");

  const homepage = pages.find((page) => page.purpose === "homepage");
  push("homepage", 5, Boolean(homepage), homepage ? "Homepage present." : "No homepage purpose page.");

  const heroFirstOk = pages.every((page) => {
    const visuals = visualSections(page);
    return visuals.length === 0 || visuals[0].templateId.startsWith("hero");
  });
  push("hero_leads", 10, heroFirstOk, heroFirstOk ? "Every page opens with its hero (single h1)." : "A page does not open with a hero section.");

  const noIndexOk = pages.every((page) => !page.seo.noIndex);
  push("indexable", 10, noIndexOk, noIndexOk ? "No public page is noIndexed." : "A public page carries noIndex.");

  const serviceCount = input.bundle.businessProfile.services.length;
  const servicePages = pages.filter((page) => page.purpose === "service_landing");
  const servicePagesOk = serviceCount < 3 || servicePages.length > 0;
  push(
    "service_pages",
    10,
    servicePagesOk,
    servicePagesOk ? "Service landing coverage matches catalog depth." : `${serviceCount} services but no service landing pages.`
  );

  const internalLinksOk =
    servicePages.length === 0 ||
    pages.some((page) =>
      visualSections(page).some((visual) => (looseSlots(visual).items?.items ?? []).some((item) => typeof item.href === "string"))
    );
  push("internal_links", 5, internalLinksOk, internalLinksOk ? "Internal links reach service pages." : "Service pages exist but nothing links to them.");

  const localBusiness = makeLocalBusinessJsonLdForBundle({ business: input.bundle.businessProfile });
  push("local_business_jsonld", 10, Boolean(localBusiness), localBusiness ? "LocalBusiness JSON-LD available." : "LocalBusiness JSON-LD unavailable.");

  const hasFaqSection = pages.some((page) => visualSections(page).some((visual) => visual.templateId === "faq_list"));
  const faqJsonLdOk = !hasFaqSection || pages.some((page) => Boolean(faqPageJsonLd(version, page.id)));
  push("faq_jsonld", 5, faqJsonLdOk, faqJsonLdOk ? "FAQ JSON-LD matches FAQ content." : "FAQ section present without FAQPage JSON-LD.");

  // Perf proxies: per-page image budget and font-family budget.
  const imageBudgetOk = pages.every((page) => {
    const imageCount = visualSections(page).reduce((count, visual) => {
      const slots = looseSlots(visual);
      const mediaImages = slots.media?.items?.length ?? 0;
      const itemImages = (slots.items?.items ?? []).filter((item) => item.mediaUrl).length;
      return count + mediaImages + itemImages;
    }, 0);
    return imageCount <= 14;
  });
  push("image_budget", 8, imageBudgetOk, imageBudgetOk ? "Per-page image count within budget." : "A page exceeds the 14-image budget.");

  const fontPairing = (version as { artDirection?: { fontPairingId?: string } }).artDirection?.fontPairingId;
  push("font_budget", 7, Boolean(fontPairing), fontPairing ? `Single font pairing (${fontPairing}).` : "No font pairing recorded.");

  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  const passed = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  return { score: Math.round((passed / total) * 100), checks };
}
