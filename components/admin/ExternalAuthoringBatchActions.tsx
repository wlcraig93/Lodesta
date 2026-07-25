"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ProductDialog";
import { AdminButton } from "@/components/admin/AdminButton";

export function ExternalBatchRefreshButton() {
  const router = useRouter();
  return <AdminButton onClick={() => router.refresh()}>Refresh</AdminButton>;
}

export function ExternalBatchCancelButton({ batchId, disabled }: { batchId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  async function cancel() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/authoring-batches/${encodeURIComponent(batchId)}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        setError(payload.error ?? "Unable to cancel batch.");
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    } catch {
      setError("Unable to cancel batch. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <AdminButton
        variant="ghost"
        disabled={disabled || pending}
        aria-haspopup="dialog"
        onClick={() => {
          setError("");
          setConfirmOpen(true);
        }}
      >
        Cancel batch
      </AdminButton>
      <ConfirmDialog
        open={confirmOpen}
        title="Cancel this batch?"
        description="Queued work will be cancelled and active claims will be fenced. Completed candidates will remain available."
        confirmLabel="Cancel batch"
        confirmPendingLabel="Cancelling…"
        tone="danger"
        pending={pending}
        error={error}
        onConfirm={() => void cancel()}
        onClose={() => {
          if (pending) return;
          setConfirmOpen(false);
          setError("");
        }}
      />
    </>
  );
}

export function ExternalPreviewButton({ previewId }: { previewId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function openPreview() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/previews/${encodeURIComponent(previewId)}/link`, {
        cache: "no-store"
      });
      const payload = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        setError(payload.error ?? "Unable to create preview link.");
        return;
      }
      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch {
      setError("Unable to create preview link. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="external-authoring-action">
      <AdminButton size="sm" variant="secondary" onClick={() => void openPreview()} disabled={pending}>
        {pending ? "Opening…" : "Open preview"}
      </AdminButton>
      {error ? <small className="form-error" role="alert">{error}</small> : null}
    </span>
  );
}

export function ExternalRetryButton({ batchId, itemId }: { batchId: string; itemId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function retry() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/authoring-batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/retry`,
        { method: "POST" }
      );
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Unable to retry execution.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to retry execution. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="external-authoring-action">
      <AdminButton size="sm" variant="secondary" onClick={() => void retry()} disabled={pending}>
        {pending ? "Requeueing…" : "Retry draft"}
      </AdminButton>
      {error ? <small className="form-error" role="alert">{error}</small> : null}
    </span>
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
