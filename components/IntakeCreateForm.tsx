"use client";

import { useState } from "react";

export function IntakeCreateForm() {
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = Boolean(url.trim() || prompt.trim().length >= 3);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setStatus("");
    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim() || undefined,
          prompt: prompt.trim() || undefined
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(result.error ?? "Unable to generate site.");
        return;
      }
      setStatus("Site generation ready.");
      window.location.assign(result.adminReviewUrl ?? `/admin/site-candidates/${result.siteCandidateId ?? ""}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to generate site.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="editor-form intake-create-form" onSubmit={onSubmit} aria-busy={submitting}>
      <label>
        <span>Existing website URL</span>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="example-business.com"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoComplete="url"
          disabled={submitting}
        />
      </label>
      <label>
        <span>Build prompt</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Build a call-first site for a family-owned HVAC company in Tulsa."
          disabled={submitting}
        />
      </label>
      {submitting ? (
        <div className="generation-progress" role="status" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <div>
            <strong>Creating site candidate</strong>
            <span>Running intake, crawl, model planning, visual QA, and candidate persistence.</span>
          </div>
        </div>
      ) : (
        <button className="button primary" type="submit" disabled={!canSubmit}>
          Create site candidate
        </button>
      )}
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}
