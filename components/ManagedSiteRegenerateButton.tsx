"use client";

import { useState } from "react";

export function ManagedSiteRegenerateButton({ siteId }: { siteId: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function regenerate() {
    if (submitting) return;
    if (!window.confirm("Generate a replacement site from the current business facts and source URL? The live site will not change until operator review.")) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sites/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      setMessage(response.ok ? payload.message ?? "Replacement generation queued." : payload.error ?? "Unable to queue regeneration.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to queue regeneration.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button className="button secondary" type="button" onClick={regenerate} disabled={submitting}>
        {submitting ? "Queueing..." : "Regenerate site"}
      </button>
      {message ? <p className="form-status">{message}</p> : null}
    </div>
  );
}
