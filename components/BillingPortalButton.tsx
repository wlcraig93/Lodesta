"use client";

import { useState } from "react";

type BillingPortalButtonProps = {
  siteId: string;
  returnPath: string;
  disabled?: boolean;
  disabledReason?: string;
};

export function BillingPortalButton({ siteId, returnPath, disabled, disabledReason }: BillingPortalButtonProps) {
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function openPortal() {
    if (disabled) {
      setStatus(disabledReason ?? "Billing is not ready for this site.");
      return;
    }
    setSubmitting(true);
    setStatus("");
    const response = await fetch("/api/billing/portal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, returnPath })
    });
    const payload = await response.json();
    setSubmitting(false);
    if (!response.ok || !payload.portal?.url) {
      setStatus(payload.error ?? "Billing portal is unavailable.");
      return;
    }
    window.location.href = payload.portal.url;
  }

  return (
    <div className="button-stack">
      <button className="button secondary" type="button" onClick={openPortal} disabled={submitting}>
        {submitting ? "Opening..." : "Billing"}
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </div>
  );
}
