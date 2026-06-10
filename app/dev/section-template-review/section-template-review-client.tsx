"use client";

import { useState, type CSSProperties } from "react";

import type { SectionTemplateDefinitionV3 } from "@/lib/generated-site-v3-section-templates";
import {
  compileVisualSectionV3,
  type ImageBackgroundV3,
  type IntroGridCardTreatmentV3,
  type NonImageBackgroundV3,
  type SectionBackgroundOptionV3,
  type SplitMediaSideV3,
  type VisualSectionConstraintViolationV3,
  type VisualSectionV3
} from "@/lib/generated-site-v3-visual-controls";
import { VisualSectionRendererV3 } from "@/lib/site-renderer-v3";

export type SectionTemplateReviewItem = {
  orderIndex: number;
  reviewAnchorId: string;
  reviewLabel: string;
  reviewId: string;
  reviewDescription: string;
  sourceSiteLabel: string;
  template: SectionTemplateDefinitionV3;
  section: VisualSectionV3;
  violations: VisualSectionConstraintViolationV3[];
};

type SectionTemplateReviewClientProps = {
  items: SectionTemplateReviewItem[];
  templateCount: number;
  renderShell: {
    rendererVersion: string;
    designSchemaVersion: string;
    artRecipe: string;
    density: string;
    style: CSSProperties;
  };
};

type HeroAlignmentV3 = "left" | "center";

type ReviewSelection = {
  backgroundKey?: BackgroundControlKey;
  heroAlign?: HeroAlignmentV3;
  introGridCardTreatment?: IntroGridCardTreatmentV3;
  splitMediaSide?: SplitMediaSideV3;
};

const imageBackgroundV3: ImageBackgroundV3 = {
  kind: "image",
  url: "/generated-site-assets/auto-body/bodywork-hero-v1.jpg",
  focalPoint: "center"
};

const backgroundControlOptions = [
  { key: "solid-page", label: "Page", background: { kind: "solid", token: "page" } },
  { key: "solid-surface", label: "Surface", background: { kind: "solid", token: "surface" } },
  { key: "solid-dark", label: "Dark", background: { kind: "solid", token: "dark" } },
  { key: "solid-brand", label: "Brand", background: { kind: "solid", token: "brand" } },
  { key: "gradient-subtle", label: "Subtle gradient", background: { kind: "gradient", token: "subtle" } },
  { key: "gradient-brand", label: "Brand gradient", background: { kind: "gradient", token: "brand" } },
  { key: "image", label: "Image", background: imageBackgroundV3 }
] as const satisfies readonly {
  key: string;
  label: string;
  background: SectionBackgroundOptionV3;
}[];

type BackgroundControlKey = (typeof backgroundControlOptions)[number]["key"];

export default function SectionTemplateReviewClient({ items, templateCount, renderShell }: SectionTemplateReviewClientProps) {
  const [selections, setSelections] = useState<Record<string, ReviewSelection>>({});

  function updateSelection(reviewAnchorId: string, patch: ReviewSelection) {
    setSelections((current) => ({
      ...current,
      [reviewAnchorId]: {
        ...current[reviewAnchorId],
        ...patch
      }
    }));
  }

  return (
    <main className="section-template-review-page">
      <header className="section-template-review-toolbar">
        <div>
          <p>V3 section template review</p>
          <h1>Active section templates</h1>
        </div>
        <span>{templateCount} templates / {items.length} states</span>
      </header>

      <nav className="section-template-review-nav" aria-label="Section templates">
        {items.map((item) => (
          <a key={item.reviewAnchorId} href={`#${item.reviewAnchorId}`}>
            <span>{String(item.orderIndex + 1).padStart(2, "0")}</span>
            {item.reviewLabel}
          </a>
        ))}
      </nav>

      <div
        className="section-template-review-render public-site public-site-v3"
        data-renderer-version={renderShell.rendererVersion}
        data-design-schema-version={renderShell.designSchemaVersion}
        data-art-recipe={renderShell.artRecipe}
        data-density={renderShell.density}
        style={renderShell.style}
      >
        {items.map((item) => {
          const selection = selections[item.reviewAnchorId] ?? {};
          const activeSection = activeSectionForReviewItem(item, selection);
          const compiled = compileVisualSectionV3(activeSection);
          const renderedSection = {
            ...compiled.section,
            anchorId: `${item.reviewAnchorId}-render`
          };

          return (
            <div key={item.reviewAnchorId} className="section-template-review-item">
              <div id={item.reviewAnchorId} className="section-template-review-label">
                <div>
                  <span>{String(item.orderIndex + 1).padStart(2, "0")}</span>
                  <strong>{item.reviewLabel}</strong>
                </div>
                <div>
                  <h2>{item.reviewId}</h2>
                  <p>{item.reviewDescription}</p>
                </div>
                <dl>
                  <div>
                    <dt>Template</dt>
                    <dd>{item.template.id}</dd>
                  </div>
                  <div>
                    <dt>Rhythm</dt>
                    <dd>{item.template.rhythmRole}</dd>
                  </div>
                  <div>
                    <dt>Background</dt>
                    <dd>{backgroundLabelV3(renderedSection.options.background)}</dd>
                  </div>
                  <div>
                    <dt>Align</dt>
                    <dd>{renderedSection.templateId === "hero_statement" ? renderedSection.options.align : "n/a"}</dd>
                  </div>
                  <div>
                    <dt>Media side</dt>
                    <dd>{renderedSection.templateId === "split_media" ? renderedSection.options.mediaSide : "n/a"}</dd>
                  </div>
                  <div>
                    <dt>Card treatment</dt>
                    <dd>{renderedSection.templateId === "intro_grid" ? renderedSection.options.cardTreatment ?? "standard" : "n/a"}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{item.sourceSiteLabel}</dd>
                  </div>
                </dl>
                <ReviewControls
                  item={item}
                  activeSection={renderedSection}
                  selection={selection}
                  onChange={(patch) => updateSelection(item.reviewAnchorId, patch)}
                />
              </div>
              <VisualSectionRendererV3 section={renderedSection} violations={compiled.violations} />
            </div>
          );
        })}
      </div>
    </main>
  );
}

function ReviewControls({
  item,
  activeSection,
  selection,
  onChange
}: {
  item: SectionTemplateReviewItem;
  activeSection: VisualSectionV3;
  selection: ReviewSelection;
  onChange: (patch: ReviewSelection) => void;
}) {
  const backgroundOptions = validBackgroundControlOptions(activeSection);
  const activeBackgroundKey = backgroundKeyV3(activeSection.options.background);
  const heroAlign = activeSection.templateId === "hero_statement" ? activeSection.options.align : undefined;
  const introGridCardTreatment = activeSection.templateId === "intro_grid" ? activeSection.options.cardTreatment ?? "standard" : undefined;
  const splitMediaSide = activeSection.templateId === "split_media" ? activeSection.options.mediaSide : undefined;

  return (
    <div className="section-template-review-controls">
      {activeSection.templateId === "hero_statement" ? (
        <div className="section-template-review-control-group" aria-label={`${item.reviewLabel} alignment`}>
          <span>Align</span>
          <div>
            {(["left", "center"] as const).map((align) => (
              <button
                key={align}
                type="button"
                aria-pressed={heroAlign === align}
                onClick={() => onChange({ heroAlign: align })}
              >
                {align}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {activeSection.templateId === "split_media" ? (
        <div className="section-template-review-control-group" aria-label={`${item.reviewLabel} media side`}>
          <span>Media side</span>
          <div>
            {(["left", "right"] as const).map((mediaSide) => (
              <button
                key={mediaSide}
                type="button"
                aria-pressed={splitMediaSide === mediaSide}
                onClick={() => onChange({ splitMediaSide: mediaSide })}
              >
                {mediaSide}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {activeSection.templateId === "intro_grid" ? (
        <div className="section-template-review-control-group" aria-label={`${item.reviewLabel} card treatment`}>
          <span>Card treatment</span>
          <div>
            {(["standard", "comparison"] as const).map((cardTreatment) => (
              <button
                key={cardTreatment}
                type="button"
                aria-pressed={introGridCardTreatment === cardTreatment}
                onClick={() => onChange({ introGridCardTreatment: cardTreatment })}
              >
                {cardTreatment}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="section-template-review-control-group" aria-label={`${item.reviewLabel} background`}>
        <span>Background</span>
        <div>
          {backgroundOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={(selection.backgroundKey ?? activeBackgroundKey) === option.key && activeBackgroundKey === option.key}
              onClick={() => onChange({ backgroundKey: option.key })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function activeSectionForReviewItem(item: SectionTemplateReviewItem, selection: ReviewSelection): VisualSectionV3 {
  if (item.section.templateId === "hero_split") {
    const background = selectedBackgroundV3(selection.backgroundKey, nonImageBackgroundControlOptions(), item.section.options.background);
    return {
      ...item.section,
      options: {
        background: asNonImageBackgroundV3(background)
      }
    };
  }

  if (item.section.templateId === "hero_statement") {
    const background = selectedBackgroundV3(selection.backgroundKey, backgroundControlOptions, item.section.options.background);
    return {
      ...item.section,
      options: {
        align: selection.heroAlign ?? item.section.options.align,
        background
      }
    };
  }

  if (item.section.templateId === "split_media") {
    return {
      ...item.section,
      options: {
        mediaSide: selection.splitMediaSide ?? item.section.options.mediaSide,
        background: selectedBackgroundV3(selection.backgroundKey, nonImageBackgroundControlOptions(), item.section.options.background)
      }
    };
  }

  if (item.section.templateId === "intro_grid") {
    return {
      ...item.section,
      options: {
        cardTreatment: selection.introGridCardTreatment ?? item.section.options.cardTreatment ?? "standard",
        background: selectedBackgroundV3(selection.backgroundKey, nonImageBackgroundControlOptions(), item.section.options.background)
      }
    };
  }

  return {
    ...item.section,
    options: {
      background: selectedBackgroundV3(selection.backgroundKey, nonImageBackgroundControlOptions(), item.section.options.background)
    }
  };
}

function selectedBackgroundV3(
  selectedKey: BackgroundControlKey | undefined,
  validOptions: readonly (typeof backgroundControlOptions)[number][],
  fallback: SectionBackgroundOptionV3
): SectionBackgroundOptionV3 {
  const selected = selectedKey ? backgroundControlOptions.find((option) => option.key === selectedKey)?.background : undefined;
  if (selected && validOptions.some((option) => backgroundKeyV3(option.background) === backgroundKeyV3(selected))) return selected;
  if (validOptions.some((option) => backgroundKeyV3(option.background) === backgroundKeyV3(fallback))) return fallback;
  return validOptions[0]?.background ?? fallback;
}

function validBackgroundControlOptions(section: VisualSectionV3) {
  if (section.templateId === "hero_statement") return backgroundControlOptions;
  return nonImageBackgroundControlOptions();
}

function nonImageBackgroundControlOptions() {
  return backgroundControlOptions.filter((option) => option.background.kind !== "image");
}

function asNonImageBackgroundV3(background: SectionBackgroundOptionV3): NonImageBackgroundV3 {
  if (background.kind !== "image") return background;
  return { kind: "solid", token: "page" };
}

function backgroundKeyV3(background: SectionBackgroundOptionV3): BackgroundControlKey {
  if (background.kind === "image") return "image";
  return `${background.kind}-${background.token}` as BackgroundControlKey;
}

function backgroundLabelV3(background: SectionBackgroundOptionV3) {
  if (background.kind === "image") return `image-${background.focalPoint ?? "center"}`;
  return `${background.kind}-${background.token}`;
}
