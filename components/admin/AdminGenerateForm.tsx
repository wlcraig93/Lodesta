"use client";

import { useEffect, useState } from "react";
import { AdminButton, AdminButtonLink, AdminButtonRow } from "@/components/admin/AdminButton";

type IntakeResponse = {
  ok?: boolean;
  mode?: "async_job";
  jobId?: string;
  statusUrl?: string;
  error?: string;
};

type IntakeJobStatus = {
  job?: {
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    errorCode: string | null;
    failureReason: string | null;
    runId: string | null;
  };
  generation?: {
    id?: string;
    businessName?: string;
    readiness?: string | null;
    adminReviewUrl?: string;
  };
  worker?: {
    state: "active" | "not_processing";
  };
  error?: string;
};

export function AdminGenerateForm() {
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IntakeResponse | null>(null);
  const [jobStatus, setJobStatus] = useState<IntakeJobStatus | null>(null);
  const canSubmit = Boolean(url.trim() || prompt.trim().length >= 3);

  useEffect(() => {
    if (!result?.statusUrl) return;
    const statusUrl: string = result.statusUrl;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch(statusUrl, { headers: { Accept: "application/json" } });
        const payload = (await response.json().catch(() => ({}))) as IntakeJobStatus;
        if (cancelled) return;
        setJobStatus(response.ok ? payload : { error: payload.error ?? "Unable to load generation job status." });
        const status = payload.job?.status;
        if (status === "queued" || status === "running") {
          timer = setTimeout(poll, 2500);
        }
      } catch (error) {
        if (!cancelled) setJobStatus({ error: error instanceof Error ? error.message : "Unable to load generation job status." });
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [result?.statusUrl]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setResult(null);
    setJobStatus(null);
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

  const reviewUrl = jobStatus?.generation?.adminReviewUrl;
  const telemetryUrl = jobStatus?.job?.runId ? `/admin/runs/${jobStatus.job.runId}` : undefined;
  const jobState = jobStatus?.job?.status;
  const failureReason = jobStatus?.job?.failureReason;
  const statusText = jobStatus?.worker?.state === "not_processing"
    ? "Queued; no worker has picked this up yet."
    : jobState === "queued"
      ? "Queued for generation."
      : jobState === "running"
        ? "Generation is running."
        : jobState === "completed"
          ? "Generation completed."
          : jobState === "failed"
            ? failureReason ?? "Generation failed."
            : result?.jobId
              ? "Generation job created."
              : undefined;

  return (
    <form className="editor-form admin-generate-form" onSubmit={onSubmit} aria-busy={submitting}>
      <label>
        <span>Website URL</span>
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
        <span>Optional guidance</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Lean into phone calls, emergency services, and trust proof."
          disabled={submitting}
        />
      </label>
      {submitting ? (
        <div className="generation-progress" role="status" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <div>
            <strong>Queueing site generation</strong>
            <span>The worker will run crawl, model planning, visual QA, and candidate persistence.</span>
          </div>
        </div>
      ) : (
        <AdminButton variant="primary" type="submit" disabled={!canSubmit}>
          Create site generation
        </AdminButton>
      )}
      {result?.error ? <p className="form-status error-text">{result.error}</p> : null}
      {result && !result.error ? (
        <div className="generation-result">
          <strong>{jobStatus?.generation?.businessName ?? "Site generation queued"}</strong>
          {statusText ? <p className={jobState === "failed" ? "form-status error-text" : "muted"}>{statusText}</p> : null}
          <AdminButtonRow>
            {reviewUrl ? (
              <AdminButtonLink variant="secondary" size="sm" href={reviewUrl}>
                Review
              </AdminButtonLink>
            ) : null}
            {telemetryUrl ? (
              <AdminButtonLink variant="secondary" size="sm" href={telemetryUrl}>
                Telemetry
              </AdminButtonLink>
            ) : null}
          </AdminButtonRow>
        </div>
      ) : null}
    </form>
  );
}
