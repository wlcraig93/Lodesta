import type { PresenceAssessment, RenderInspectionResult, Vertical } from "./models";
import type { CrawlAssessment } from "./crawler";
import type { PublicPresenceEnrichment } from "./public-presence";
import { inferVertical, slugify } from "./intake";
import { evaluateCrawlAgainstStandard } from "./standard-evaluation";

export type PresenceIntakeResult = {
  sourceUrl: string;
  inferredVertical: Vertical;
  assessment: PresenceAssessment;
  crawl?: CrawlAssessment;
  renderInspection?: RenderInspectionResult;
  publicPresence?: PublicPresenceEnrichment;
  crawlPlan: Array<{
    adapter: "fetch" | "playwright" | "external_browser";
    purpose: string;
  }>;
  designDirectionPrompts: string[];
};

export function createPresenceIntakePlan(
  sourceUrl: string,
  crawl?: CrawlAssessment,
  renderInspection?: RenderInspectionResult,
  publicPresence?: PublicPresenceEnrichment
): PresenceIntakeResult {
  const inferredVertical = inferVertical({ url: sourceUrl });
  const siteId = `site_${slugify(new URL(sourceUrl).hostname.replace(/^www\./, ""))}`;

  return {
    sourceUrl,
    inferredVertical,
    assessment: {
      siteId,
      sourceUrl,
      standardEvaluation: crawl ? evaluateCrawlAgainstStandard(crawl) : undefined,
      renderInspection,
      publicPresenceSignals: publicPresence?.signals.map((signal) => ({ ...signal, siteId })),
      technicalNotes: [
        "Fetch crawler checks status, metadata, canonicals, robots, sitemap references, links, and schema.",
        "Playwright crawler captures desktop and mobile screenshots for render and vision checks.",
        ...(crawl ? [`Initial technical/conversion quality score: ${crawl.score.percent}/100 (${crawl.score.grade}).`] : []),
        ...(renderInspection
          ? [
              `Render inspection used ${renderInspection.adapter}; ${renderInspection.screenshots.length} screenshot artifact${renderInspection.screenshots.length === 1 ? "" : "s"} captured.`,
              `${renderInspection.findings.filter((finding) => finding.severity === "fail").length} render failures and ${renderInspection.findings.filter((finding) => finding.severity === "warning").length} render warnings detected.`
            ]
          : []),
        ...(crawl?.extractedFacts.name ? [`Extracted business name candidate: ${crawl.extractedFacts.name}.`] : []),
        ...(crawl?.extractedFacts.phone ? ["Detected a click-to-call or text phone candidate."] : []),
        ...(crawl?.jsonLdTypes.length ? [`Detected schema types: ${crawl.jsonLdTypes.join(", ")}.`] : []),
        ...(crawl?.findings ?? [])
      ],
      visualNotes: [
        "Vision inspection looks for above-fold CTA clarity, mobile usability, trust proof, real-photo signals, and layout breakage.",
        "Screenshots are used for assessment and before/after comparison, not copied into generated preview content."
      ],
      brandNotes: [
        "Extract colors, typography cues, density, image style, and tone without reproducing protected marketing expression."
      ],
      publicPresenceNotes: [
        ...(crawl
          ? [
              `${crawl.extractedFacts.socialLinks.length} social links, ${crawl.extractedFacts.bookingLinks.length} booking links, and ${crawl.extractedFacts.orderingLinks.length} ordering/order links were detected from the source site.`
            ]
          : []),
        ...(publicPresence?.signals.length
          ? [
              `${publicPresence.signals.length} official/public presence candidate${publicPresence.signals.length === 1 ? "" : "s"} captured from ${publicPresence.provider}.`
            ]
          : publicPresence?.notes.slice(0, 1) ?? []),
        "Official/public presence signals are stored with provenance and confidence, then verified on claim."
      ]
    },
    crawl,
    renderInspection,
    publicPresence,
    crawlPlan: [
      { adapter: "fetch", purpose: "Cheap crawl for technical SEO and text facts." },
      { adapter: "playwright", purpose: "Screenshot, responsive, and visual assessment." },
      { adapter: "external_browser", purpose: "Optional fallback for high-volume or anti-bot crawling." }
    ],
    designDirectionPrompts: [
      "Modernized brand direction: preserve recognizable local identity, improve hierarchy, mobile CTA clarity, and trust proof.",
      "Conversion-optimized direction: emphasize primary action, social proof, service clarity, and local intent above the fold.",
      "Premium redesign direction: create a more polished version while keeping owner-truth facts and claims unchanged."
    ]
  };
}
