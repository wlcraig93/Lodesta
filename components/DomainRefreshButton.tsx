"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ProductDialog";

/** Checks a domain's DNS and certificate now, or removes the domain. */
export function DomainRefreshButton({ domainId, hostname }: { domainId: string; hostname: string }) {
  const router = useRouter();
  const removeRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState("");

  async function refresh() {
    setBusy(true);
    setMessage("Checking DNS and certificate status…");
    try {
      const response = await fetch("/api/domains/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId })
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        setMessage(result?.error ?? "We couldn't check the domain right now. Try again in a minute.");
        return;
      }
      setMessage("");
      router.refresh();
    } catch {
      setMessage("We couldn't reach Lodesta. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setRemoveError("");
    try {
      const response = await fetch("/api/domains", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId })
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        setRemoveError(result?.error ?? "We couldn't remove the domain right now. Try again in a minute.");
        return;
      }
      setConfirmRemove(false);
      router.refresh();
    } catch {
      setRemoveError("We couldn't reach Lodesta. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="button-row">
        <button className="button secondary" type="button" onClick={() => void refresh()} disabled={busy}>
          {busy && !confirmRemove ? "Checking…" : "Check connection"}
        </button>
        <button ref={removeRef} className="button danger-secondary" type="button" aria-haspopup="dialog" disabled={busy} onClick={() => { setRemoveError(""); setConfirmRemove(true); }}>
          Remove domain
        </button>
      </div>
      {message ? <p className="form-status" role="status">{message}</p> : null}
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${hostname}?`}
        description="Your website stops answering at this address within a few minutes. Your Lodesta address keeps working, and you can connect this domain again later."
        confirmLabel="Remove domain"
        confirmPendingLabel="Removing…"
        tone="danger"
        pending={busy}
        error={removeError}
        returnFocusRef={removeRef}
        onConfirm={() => void remove()}
        onClose={() => { if (!busy) setConfirmRemove(false); }}
      />
    </div>
  );
}
