"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function WebsiteOnboardingForm({
  initialSource = ""
}: {
  initialSource?: string;
}) {
  const router = useRouter();
  const idempotencyKey = useRef(crypto.randomUUID());
  const sourceErrorId = useId();
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sourceError, setSourceError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const source = String(form.get("sourceUrl") ?? "").trim();
    if (!source) {
      setSourceError("Paste a public website or business source to get started.");
      setStatus("");
      sourceInputRef.current?.focus();
      return;
    }
    setSourceError("");
    setSubmitting(true);
    setStatus("Checking this source…");
    try {
      const response = await fetch("/api/site-agent/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: source,
          idempotencyKey: idempotencyKey.current,
          reportingTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        })
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        code?: string;
        siteId?: string;
        runId?: string;
        workspacePath?: string;
      };
      if (!response.ok || !result.siteId || !result.runId || !result.workspacePath) {
        setStatus(result.error ?? "This website could not be started. Try again.");
        setSubmitting(false);
        return;
      }
      router.push(result.workspacePath);
      router.refresh();
    } catch {
      setStatus("This website could not be started. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <form className="onboarding-url-form" onSubmit={submit} noValidate>
      <label className="product-visually-hidden" htmlFor="sourceUrl">Public website or business source</label>
      <div className="onboarding-url-composer">
        <input
          ref={sourceInputRef}
          id="sourceUrl"
          name="sourceUrl"
          type="text"
          inputMode="url"
          autoComplete="url"
          defaultValue={initialSource}
          placeholder="example.com or a public business URL"
          required
          maxLength={2048}
          aria-invalid={sourceError ? true : undefined}
          aria-describedby={sourceError ? sourceErrorId : undefined}
          onChange={() => { if (sourceError) setSourceError(""); }}
        />
        <button className="button primary" type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create website"}
        </button>
      </div>
      {sourceError ? <p className="form-error" id={sourceErrorId} role="alert">{sourceError}</p> : null}
      <p className="form-status" role="status" aria-live="polite">{status}</p>
    </form>
  );
}
