"use client";

import { useState } from "react";

export function EvidenceConfirmationForm({ siteId, evidenceId }: { siteId: string; evidenceId: string }) {
  const [status, setStatus] = useState<string>();
  const [pending, setPending] = useState(false);

  async function decide(decision: "confirmed" | "rejected") {
    setPending(true);
    setStatus(undefined);
    const response = await fetch("/api/evidence/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, evidenceId, decision })
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setStatus(typeof payload.error === "string" ? payload.error : "Evidence decision failed.");
      return;
    }
    window.location.reload();
  }

  return (
    <div className="button-row">
      <button className="button primary" type="button" disabled={pending} onClick={() => decide("confirmed")}>Confirm</button>
      <button className="button secondary" type="button" disabled={pending} onClick={() => decide("rejected")}>Reject</button>
      {status ? <span className="form-status error-text">{status}</span> : null}
    </div>
  );
}
