"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function AssessmentScanForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("Queueing assessment…");
    try {
      const response = await fetch("/api/presence/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const payload = await response.json() as { assessment?: { id?: string }; error?: string };
      if (!response.ok || !payload.assessment?.id) throw new Error(payload.error ?? "Assessment could not be queued.");
      router.push(`/admin/assessments/${encodeURIComponent(payload.assessment.id)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Assessment could not be queued.");
      setSubmitting(false);
    }
  }

  return (
    <form className="admin-filter-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="assessment-url">Public website URL</label>
      <input
        id="assessment-url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://example.com"
        inputMode="url"
        required
      />
      <button className="button primary" type="submit" disabled={submitting}>
        {submitting ? "Queueing…" : "Assess website"}
      </button>
      {status ? <span className="muted">{status}</span> : null}
    </form>
  );
}
