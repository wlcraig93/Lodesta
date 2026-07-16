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
    effectiveStatus: "queued_waiting_for_worker" | "queued_worker_busy" | "running" | "blocked" | "ready" | "failed";
    runId: string | null;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
  };
  candidate?: {
    id?: string;
    businessName?: string;
    readiness?: string | null;
    adminReviewUrl?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  worker?: {
    state: "active" | "busy" | "not_processing";
    activeCount?: number;
    currentJob?: { id: string; kind: string; lockedBy?: string; elapsedSeconds?: number } | null;
    warning?: string;
  };
  error?: string;
};

export function AdminGenerateForm({ onJobCreated }: { onJobCreated?: (response: IntakeResponse) => void } = {}) {
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
        setJobStatus(response.ok ? payload : { error: payload.error ?? "Unable to load candidate job status." });
        const status = payload.job?.status;
        if (status === "queued" || status === "running") {
          timer = setTimeout(poll, 2500);
        }
      } catch (error) {
        if (!cancelled) setJobStatus({ error: error instanceof Error ? error.message : "Unable to load candidate job status." });
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
      if (response.ok) {
        setResult(payload);
        onJobCreated?.(payload);
      } else {
        setResult({ error: payload.error ?? "Candidate failed." });
      }
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Candidate failed." });
    } finally {
      setSubmitting(false);
    }
  }

  const reviewUrl = jobStatus?.candidate?.adminReviewUrl;
  const telemetryUrl = jobStatus?.job?.runId ? `/admin/runs/${jobStatus.job.runId}` : undefined;
  const jobState = jobStatus?.job?.status;
  const failureReason = jobStatus?.job?.failureReason;
  const effectiveStatus = jobStatus?.job?.effectiveStatus;
  const currentJob = jobStatus?.worker?.currentJob;
  const statusText = effectiveStatus === "queued_waiting_for_worker"
    ? jobStatus?.worker?.warning ?? "Queued; worker is not running."
    : effectiveStatus === "queued_worker_busy"
      ? `Queued behind ${currentJob?.kind ?? "another job"}${currentJob?.id ? ` (${currentJob.id})` : ""}.`
      : effectiveStatus === "running"
        ? "Candidate is running."
        : effectiveStatus === "blocked"
          ? "Candidate blocked with reviewable reasons."
          : effectiveStatus === "ready"
            ? "Candidate completed and is ready for review."
            : effectiveStatus === "failed"
              ? failureReason ?? "Candidate failed."
              : result?.jobId
                ? "Candidate job created."
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
        <div className="candidate-progress" role="status" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <div>
            <strong>Queueing candidate</strong>
            <span>The worker will crawl, plan, render, QA, and persist a candidate snapshot.</span>
          </div>
        </div>
      ) : (
        <AdminButton variant="primary" type="submit" disabled={!canSubmit}>
          Create candidate
        </AdminButton>
      )}
      {result?.error ? <p className="form-status error-text">{result.error}</p> : null}
      {result && !result.error ? (
        <div className="candidate-result">
          <strong>{jobStatus?.candidate?.businessName ?? "Candidate queued"}</strong>
          {statusText ? <p className={jobState === "failed" ? "form-status error-text" : "muted"}>{statusText}</p> : null}
          <div className="candidate-result-meta" aria-label="Candidate timing">
            {jobStatus?.job?.createdAt ? <span>Job queued {formatDate(jobStatus.job.createdAt)}</span> : null}
            {jobStatus?.job?.startedAt ? <span>Started {formatDate(jobStatus.job.startedAt)}</span> : null}
            {jobStatus?.job?.completedAt ? <span>Completed {formatDate(jobStatus.job.completedAt)}</span> : null}
            {jobStatus?.candidate?.createdAt ? <span>Candidate created {formatDate(jobStatus.candidate.createdAt)}</span> : null}
            {jobStatus?.candidate?.id ? <span>{jobStatus.candidate.id}</span> : result.jobId ? <span>Job {result.jobId}</span> : null}
          </div>
          <AdminButtonRow>
            {reviewUrl ? (
              <AdminButtonLink variant="secondary" size="sm" href={reviewUrl}>
                Review
              </AdminButtonLink>
            ) : null}
            {telemetryUrl ? (
              <AdminButtonLink variant="secondary" size="sm" href={telemetryUrl}>
                Activity
              </AdminButtonLink>
            ) : null}
          </AdminButtonRow>
        </div>
      ) : null}
    </form>
  );
}

function formatDate(input: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(input));
}
