"use client";

import Link from "next/link";
import { useState } from "react";

type IntakeResponse = {
  runId?: string;
  bundle?: {
    businessProfile?: {
      name?: string;
      siteId?: string;
    };
    siteModel?: {
      slug?: string;
    };
  };
  preview?: {
    url?: string;
  };
  error?: string;
};

export function AdminGenerateForm() {
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IntakeResponse | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim() || undefined,
          prompt: prompt.trim() || undefined,
          telemetrySource: "admin_console"
        })
      });
      const payload = (await response.json().catch(() => ({}))) as IntakeResponse;
      setResult(response.ok ? payload : { error: payload.error ?? "Generation failed." });
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Generation failed." });
    } finally {
      setSubmitting(false);
    }
  }

  const slug = result?.bundle?.siteModel?.slug;

  return (
    <form className="editor-form admin-generate-form" onSubmit={onSubmit}>
      <label>
        <span>Website URL</span>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example-business.com"
          type="url"
        />
      </label>
      <label>
        <span>Optional guidance</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Lean into phone calls, emergency services, and trust proof."
        />
      </label>
      <button className="button primary" type="submit" disabled={submitting || (!url.trim() && prompt.trim().length < 3)}>
        {submitting ? "Generating..." : "Generate"}
      </button>
      {result?.error ? <p className="form-status error-text">{result.error}</p> : null}
      {result && !result.error ? (
        <div className="generation-result">
          <strong>{result.bundle?.businessProfile?.name ?? "Site generated"}</strong>
          <div className="button-row">
            {result.preview?.url ? (
              <Link className="button secondary" href={result.preview.url}>
                Preview
              </Link>
            ) : null}
            {slug ? (
              <Link className="button secondary" href={`/editor/${slug}`}>
                Editor
              </Link>
            ) : null}
            {result.runId ? (
              <Link className="button secondary" href={`/admin/runs/${result.runId}`}>
                Run
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </form>
  );
}
