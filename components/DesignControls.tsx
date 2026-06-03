"use client";

import { useState } from "react";
import type { DesignPlan, LayoutSectionKind, LayoutSectionPreset } from "@/lib/models";

type DesignControlsProps = {
  siteId: string;
  pageId: string;
  initialDesignPlan: DesignPlan;
  sections: Array<{
    id: string;
    kind: LayoutSectionKind;
    label: string;
    preset: LayoutSectionPreset;
    presetOptions: Array<{ id: LayoutSectionPreset; label: string }>;
  }>;
};

export function DesignControls({ siteId, pageId, initialDesignPlan, sections }: DesignControlsProps) {
  const [designPlan, setDesignPlan] = useState(initialDesignPlan);
  const [sectionOrder, setSectionOrder] = useState(sections);
  const [status, setStatus] = useState("");

  function moveSection(sectionId: string, direction: -1 | 1) {
    setSectionOrder((current) => {
      const index = current.findIndex((section) => section.id === sectionId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [section] = next.splice(index, 1);
      next.splice(nextIndex, 0, section);
      return next;
    });
  }

  function updateSectionPreset(sectionId: string, preset: LayoutSectionPreset) {
    setSectionOrder((current) =>
      current.map((section) => (section.id === sectionId ? { ...section, preset } : section))
    );
  }

  async function saveDesign() {
    setStatus("Saving design draft...");
    const response = await fetch("/api/sites/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId,
        pageId,
        designPlan: {
          stylePack: designPlan.stylePack,
          typographyPack: designPlan.typographyPack
        },
        layoutSectionOrder: sectionOrder.map((section) => section.id),
        sectionPresets: Object.fromEntries(sectionOrder.map((section) => [section.id, section.preset]))
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to save design draft.");
      return;
    }
    window.dispatchEvent(new Event("lodesta:preview-refresh"));
    setStatus("Design draft saved.");
  }

  return (
    <div className="design-controls">
      <div className="responsive-preview-header">
        <div>
          <span className="badge">Curated design</span>
          <h2>Design plan and sections</h2>
        </div>
      </div>

      <div className="design-plan-grid" aria-label="Design plan">
        <label>
          <span>Style pack</span>
          <select
            value={designPlan.stylePack}
            onChange={(event) => setDesignPlan((current) => ({ ...current, stylePack: event.target.value as DesignPlan["stylePack"] }))}
          >
            {stylePackOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Typography pack</span>
          <select
            value={designPlan.typographyPack}
            onChange={(event) => setDesignPlan((current) => ({ ...current, typographyPack: event.target.value as DesignPlan["typographyPack"] }))}
          >
            {typographyPackOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="section-order-list">
        {sectionOrder.map((section, index) => (
          <article key={section.id} className="section-order-row">
            <span className="badge">{section.kind}</span>
            <strong>{section.label}</strong>
            <label className="section-variant-control">
              <span>Preset</span>
              <select value={section.preset} onChange={(event) => updateSectionPreset(section.id, event.target.value as LayoutSectionPreset)}>
                {section.presetOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-row">
              <button
                className="button secondary"
                type="button"
                disabled={index === 0}
                onClick={() => moveSection(section.id, -1)}
              >
                Up
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={index === sectionOrder.length - 1}
                onClick={() => moveSection(section.id, 1)}
              >
                Down
              </button>
            </div>
          </article>
        ))}
      </div>

      <button className="button primary" type="button" onClick={() => void saveDesign()}>
        Save design draft
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </div>
  );
}

const stylePackOptions: Array<{ id: DesignPlan["stylePack"]; label: string }> = [
  { id: "local_modern", label: "Local modern" },
  { id: "premium_editorial", label: "Premium editorial" },
  { id: "urgent_service", label: "Urgent service" },
  { id: "warm_neighborhood", label: "Warm neighborhood" },
  { id: "clinical_trust", label: "Clinical trust" }
];

const typographyPackOptions: Array<{ id: DesignPlan["typographyPack"]; label: string }> = [
  { id: "clean_sans", label: "Clean sans" },
  { id: "editorial_serif", label: "Editorial serif" },
  { id: "rounded_friendly", label: "Rounded friendly" },
  { id: "utility_sans", label: "Utility sans" },
  { id: "premium_sans", label: "Premium sans" }
];
