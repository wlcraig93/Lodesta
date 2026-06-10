import { notFound } from "next/navigation";

import SectionTemplateReviewClient, {
  type SectionTemplateReviewItem
} from "./section-template-review-client";
import { createGeneratedSiteV3CanonicalVisualGrammarSites } from "@/lib/generated-site-v3-canonical-visual-grammar";
import {
  activeSectionTemplateOrderV3,
  sectionTemplateDefinitionV3,
  type SectionTemplateIdV3
} from "@/lib/generated-site-v3-section-templates";
import {
  compileVisualSectionV3,
  getVisualSectionV3,
  type VisualSectionConstraintViolationV3,
  type VisualSectionV3
} from "@/lib/generated-site-v3-visual-controls";
import { artDirectionStyle } from "@/lib/site-renderer-v3";

export const metadata = {
  title: "Section Template Review | Lodesta",
  robots: {
    index: false,
    follow: false
  }
};

export default function SectionTemplateReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const canonicalSites = createGeneratedSiteV3CanonicalVisualGrammarSites();
  const referenceSite = canonicalSites[0];
  if (!referenceSite) notFound();

  const reviewItems = buildReviewItems();

  return (
    <SectionTemplateReviewClient
      items={reviewItems}
      templateCount={activeSectionTemplateOrderV3.length}
      renderShell={{
        rendererVersion: referenceSite.version.rendererVersion,
        designSchemaVersion: referenceSite.version.designSchemaVersion,
        artRecipe: referenceSite.version.artDirection.recipeId,
        density: referenceSite.version.artDirection.density,
        style: artDirectionStyle(referenceSite.version)
      }}
    />
  );
}

function buildReviewItems(): SectionTemplateReviewItem[] {
  const canonicalSites = createGeneratedSiteV3CanonicalVisualGrammarSites();
  const candidateByTemplate = new Map<SectionTemplateIdV3, { sourceSiteLabel: string; section: VisualSectionV3 }>();

  for (const site of canonicalSites) {
    const page = site.version.pageComposition.pages[0];
    if (!page) continue;

    for (const sectionInstance of page.sections) {
      const visualSection = getVisualSectionV3(sectionInstance.props);
      if (!visualSection) continue;

      setReviewCandidateV3(candidateByTemplate, {
        sourceSiteLabel: site.label,
        section: visualSection
      });
    }
  }

  const items: SectionTemplateReviewItem[] = [];

  for (const templateId of activeSectionTemplateOrderV3) {
    const candidate = candidateByTemplate.get(templateId);
    if (!candidate) continue;
    const compiled = compileVisualSectionV3(candidate.section);
    const template = sectionTemplateDefinitionV3(templateId);
    items.push({
      orderIndex: items.length,
      reviewAnchorId: `section-template-${templateId.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      reviewLabel: template.label,
      reviewId: template.id,
      reviewDescription: template.description,
      sourceSiteLabel: candidate.sourceSiteLabel,
      template,
      section: compiled.section,
      violations: compiled.violations
    });
  }

  return items;
}

function setReviewCandidateV3(
  candidateByTemplate: Map<SectionTemplateIdV3, { sourceSiteLabel: string; section: VisualSectionV3 }>,
  candidate: { sourceSiteLabel: string; section: VisualSectionV3 }
) {
  const current = candidateByTemplate.get(candidate.section.templateId);
  if (!current) {
    candidateByTemplate.set(candidate.section.templateId, candidate);
    return;
  }

  if (
    candidate.section.templateId === "hero_statement" &&
    current.section.templateId === "hero_statement" &&
    current.section.options.background.kind === "image" &&
    candidate.section.options.background.kind !== "image"
  ) {
    candidateByTemplate.set(candidate.section.templateId, candidate);
  }
}
