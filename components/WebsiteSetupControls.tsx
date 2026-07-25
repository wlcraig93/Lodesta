"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/ProductDialog";
import type { WebsiteSetupView } from "@/lib/website-setups";

export function WebsiteSetupAction({
  setupId,
  action,
  label,
  tone = "secondary",
  onView
}: {
  setupId: string;
  action: "cancel" | "retry";
  label: string;
  tone?: "primary" | "secondary";
  onView?(view: WebsiteSetupView): void;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function run() {
    setPending(true);
    setStatus("");
    try {
      const response = await fetch(`/api/website-setups/${setupId}/${action}`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string; view?: WebsiteSetupView };
      if (!response.ok) {
        setStatus(result.error ?? "That action could not be completed.");
        return;
      }
      if (result.view) onView?.(result.view);
      if (action === "cancel") {
        setConfirmOpen(false);
        router.replace("/account/onboarding");
      } else if (!onView) {
        router.refresh();
      }
    } catch {
      setStatus("That action could not be completed. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  function closeConfirmation() {
    if (pending) return;
    setConfirmOpen(false);
    setStatus("");
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={`button ${tone}`}
        type="button"
        disabled={pending}
        aria-haspopup={action === "cancel" ? "dialog" : undefined}
        onClick={() => {
          if (action === "cancel") {
            setStatus("");
            setConfirmOpen(true);
          } else {
            void run();
          }
        }}
      >
        {pending && action !== "cancel" ? "Working…" : label}
      </button>
      {action === "cancel" ? (
        <ConfirmDialog
          open={confirmOpen}
          title="Cancel website setup?"
          description="This stops the current setup and removes it from your account. You won’t be able to resume it."
          confirmLabel="Cancel setup"
          confirmPendingLabel="Cancelling…"
          tone="danger"
          pending={pending}
          error={status}
          returnFocusRef={triggerRef}
          onConfirm={() => void run()}
          onClose={closeConfirmation}
        />
      ) : status ? <span className="form-status" role="status">{status}</span> : null}
    </>
  );
}

export function WebsiteSetupSourceForm({
  setupId,
  sourceUrl,
  onView
}: {
  setupId: string;
  sourceUrl: string;
  onView?(view: WebsiteSetupView): void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const sourceErrorId = useId();
  const sourceRef = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const source = String(form.get("sourceUrl") ?? "").trim();
    if (!source) {
      setSourceError("Enter the website address you want to use instead.");
      setStatus("");
      sourceRef.current?.focus();
      return;
    }
    setSourceError("");
    setPending(true);
    const response = await fetch(`/api/website-setups/${setupId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceUrl: source }) });
    const result = await response.json().catch(() => ({})) as { error?: string; view?: WebsiteSetupView };
    if (!response.ok) { setStatus(result.error ?? "The website address could not be changed."); setPending(false); return; }
    setStatus("Website changed. We’ll try again now.");
    if (result.view) onView?.(result.view);
    else router.refresh();
    setPending(false);
  }
  return (
    <form className="setup-source-form" onSubmit={submit} noValidate>
      <label htmlFor="replacementSource">Use a different website</label>
      <div><input ref={sourceRef} id="replacementSource" name="sourceUrl" type="text" inputMode="url" defaultValue={sourceUrl} required maxLength={2048} aria-invalid={sourceError ? true : undefined} aria-describedby={sourceError ? sourceErrorId : undefined} onChange={() => { if (sourceError) setSourceError(""); }} /><button className="button secondary" type="submit" disabled={pending}>{pending ? "Saving…" : "Change website"}</button></div>
      {sourceError ? <p className="form-error" id={sourceErrorId} role="alert">{sourceError}</p> : null}
      <p className="form-status" role="status">{status}</p>
    </form>
  );
}
