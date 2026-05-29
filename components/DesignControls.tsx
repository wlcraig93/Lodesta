"use client";

import { useState } from "react";
import { themePresetOptions, type ThemePresetId } from "@/lib/theme-presets";

type DesignControlsProps = {
  siteId: string;
  pageId: string;
  initialPreset: ThemePresetId;
  sections: Array<{
    id: string;
    type: string;
    label: string;
    variant: string;
    variantOptions: Array<{ id: string; label: string }>;
  }>;
};

export function DesignControls({ siteId, pageId, initialPreset, sections }: DesignControlsProps) {
  const [themePreset, setThemePreset] = useState<ThemePresetId>(initialPreset);
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

  function updateSectionVariant(sectionId: string, variant: string) {
    setSectionOrder((current) =>
      current.map((section) => (section.id === sectionId ? { ...section, variant } : section))
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
        themePreset,
        sectionOrder: sectionOrder.map((section) => section.id),
        sectionVariants: Object.fromEntries(sectionOrder.map((section) => [section.id, section.variant]))
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
          <h2>Theme and order</h2>
        </div>
      </div>

      <div className="palette-grid" aria-label="Theme palette">
        {themePresetOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={themePreset === option.id ? "active" : ""}
            onClick={() => setThemePreset(option.id)}
          >
            <span className={`palette-swatch palette-${option.id}`} aria-hidden="true" />
            {option.label}
          </button>
        ))}
      </div>

      <div className="section-order-list">
        {sectionOrder.map((section, index) => (
          <article key={section.id} className="section-order-row">
            <span className="badge">{section.type}</span>
            <strong>{section.label}</strong>
            <label className="section-variant-control">
              <span>Variant</span>
              <select value={section.variant} onChange={(event) => updateSectionVariant(section.id, event.target.value)}>
                {section.variantOptions.map((option) => (
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
