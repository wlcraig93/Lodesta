"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ProductDialog";

/** Takes the published site offline, or puts the same version back online. */
export function SiteOnlineToggle({ siteId, online }: { siteId: string; online: boolean }) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function setOnline(next: boolean) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/online`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ online: next })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "We couldn't change your site right now. Try again in a minute.");
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError("We couldn't reach Lodesta. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (!online) {
    return (
      <div className="button-row">
        <button className="button" type="button" disabled={pending} onClick={() => void setOnline(true)}>
          {pending ? "Putting it back online…" : "Put site back online"}
        </button>
        {error ? <p className="form-status" role="alert">{error}</p> : null}
      </div>
    );
  }
  return (
    <>
      <div className="button-row">
        <button ref={triggerRef} className="button danger-secondary" type="button" aria-haspopup="dialog" onClick={() => { setError(""); setConfirming(true); }}>
          Take site offline
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Take your site offline?"
        description="Visitors will see a short “temporarily unavailable” page instead of your website, and forms stop taking inquiries. Nothing is deleted. You can put the same version back online at any time."
        confirmLabel="Take offline"
        confirmPendingLabel="Taking offline…"
        tone="danger"
        pending={pending}
        error={error}
        returnFocusRef={triggerRef}
        onConfirm={() => void setOnline(false)}
        onClose={() => { if (!pending) setConfirming(false); }}
      />
    </>
  );
}
