"use client";

import { useEffect, useState } from "react";

type ResponsivePreviewProps = {
  siteSlug: string;
};

type PreviewMode = "desktop" | "tablet" | "mobile";

const modes: Record<PreviewMode, { label: string; width: number | "100%" }> = {
  desktop: { label: "Desktop", width: "100%" },
  tablet: { label: "Tablet", width: 768 },
  mobile: { label: "Mobile", width: 390 }
};

export function ResponsivePreview({ siteSlug }: ResponsivePreviewProps) {
  const [mode, setMode] = useState<PreviewMode>("desktop");
  const [refreshKey, setRefreshKey] = useState(0);
  const active = modes[mode];

  useEffect(() => {
    function refreshPreview() {
      setRefreshKey((current) => current + 1);
    }
    window.addEventListener("lodesta:preview-refresh", refreshPreview);
    return () => window.removeEventListener("lodesta:preview-refresh", refreshPreview);
  }, []);

  return (
    <div className="responsive-preview">
      <div className="responsive-preview-header">
        <div>
          <span className="badge">Draft preview</span>
          <h2>Responsive view</h2>
        </div>
        <div className="segmented-control preview-mode-control" aria-label="Preview size">
          {Object.entries(modes).map(([key, value]) => (
            <button
              key={key}
              type="button"
              className={mode === key ? "active" : ""}
              onClick={() => setMode(key as PreviewMode)}
            >
              {value.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`preview-stage preview-stage-${mode}`}>
        <iframe
          title={`${active.label} draft preview`}
          src={`/editor/${siteSlug}/preview?refresh=${refreshKey}`}
          style={{ width: active.width }}
        />
      </div>
    </div>
  );
}
