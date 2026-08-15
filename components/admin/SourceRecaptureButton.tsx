"use client";

import { useState } from "react";

export function SourceRecaptureButton({ siteId }: { siteId: string }) {
  const [status, setStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [message, setMessage] = useState("");
  return <div>
    <button className="button secondary" type="button" disabled={status === "running"} onClick={async () => {
      setStatus("running");
      setMessage("Capturing the current source site…");
      try {
        const response = await fetch(`/api/admin/sites/${siteId}/source-recapture`, { method: "POST" });
        const payload = await response.json() as { unchanged?: boolean; sourceSnapshotId?: string; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Source recapture failed.");
        setStatus("complete");
        setMessage(payload.unchanged ? "The source mirror was already current." : `Captured ${payload.sourceSnapshotId}. Reload to inspect it.`);
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Source recapture failed.");
      }
    }}>{status === "running" ? "Capturing…" : "Recapture source"}</button>
    {message ? <p aria-live="polite" className={status === "error" ? "form-error" : "muted"}>{message}</p> : null}
  </div>;
}
