"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminButton } from "@/components/admin/AdminButton";

export function ExternalBatchRefreshButton() {
  const router = useRouter();
  return <AdminButton onClick={() => router.refresh()}>Refresh</AdminButton>;
}

export function ExternalBatchCancelButton({ batchId, disabled }: { batchId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function cancel() {
    if (!window.confirm("Cancel queued work and fence active claims for this batch? Completed candidates will remain available.")) return;
    setPending(true);
    const response = await fetch(`/api/admin/authoring-batches/${encodeURIComponent(batchId)}`, { method: "DELETE" });
    setPending(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      window.alert(payload.error ?? "Unable to cancel batch.");
      return;
    }
    router.refresh();
  }
  return (
    <AdminButton variant="ghost" disabled={disabled || pending} onClick={cancel}>
      {pending ? "Cancelling…" : "Cancel batch"}
    </AdminButton>
  );
}

export function ExternalPreviewButton({ previewId }: { previewId: string }) {
  const [pending, setPending] = useState(false);
  async function openPreview() {
    setPending(true);
    const response = await fetch(`/api/admin/previews/${encodeURIComponent(previewId)}/link`, {
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({})) as { url?: string; error?: string };
    setPending(false);
    if (!response.ok || !payload.url) {
      window.alert(payload.error ?? "Unable to create preview link.");
      return;
    }
    window.open(payload.url, "_blank", "noopener,noreferrer");
  }
  return (
    <AdminButton size="sm" variant="secondary" onClick={openPreview} disabled={pending}>
      {pending ? "Opening…" : "Open preview"}
    </AdminButton>
  );
}

export function ExternalRetryButton({ batchId, itemId }: { batchId: string; itemId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function retry() {
    setPending(true);
    const response = await fetch(
      `/api/admin/authoring-batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/retry`,
      { method: "POST" }
    );
    const payload = await response.json().catch(() => ({})) as { error?: string };
    setPending(false);
    if (!response.ok) {
      window.alert(payload.error ?? "Unable to retry execution.");
      return;
    }
    router.refresh();
  }
  return (
    <AdminButton size="sm" variant="secondary" onClick={retry} disabled={pending}>
      {pending ? "Requeueing…" : "Retry draft"}
    </AdminButton>
  );
}

export function ExternalClarificationForm({
  batchId,
  itemId,
  question
}: {
  batchId: string;
  itemId: string;
  question: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(
      `/api/admin/authoring-batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/clarification`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: String(form.get("answer") ?? "") })
      }
    );
    const payload = await response.json().catch(() => ({})) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(payload.error ?? "Unable to submit clarification.");
      return;
    }
    router.refresh();
  }
  return (
    <form className="external-clarification" onSubmit={submit}>
      <p>{question}</p>
      <div>
        <input name="answer" required maxLength={4000} aria-label="Clarification answer" />
        <AdminButton size="sm" variant="primary" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Reply"}
        </AdminButton>
      </div>
      {error ? <small className="form-error" role="alert">{error}</small> : null}
    </form>
  );
}
