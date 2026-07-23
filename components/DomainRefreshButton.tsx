"use client";

import { useState } from "react";

export function DomainRefreshButton({ domainId }: { domainId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    setBusy(true);
    setMessage("Checking DNS and certificate status…");
    const response = await fetch("/api/domains/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domainId })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      setMessage(result?.error ?? "The domain check could not be completed.");
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return (
    <div>
      <button className="button secondary" type="button" onClick={refresh} disabled={busy}>
        {busy ? "Checking…" : "Check connection"}
      </button>
      {message ? <p className="form-status" role="status">{message}</p> : null}
    </div>
  );
}
