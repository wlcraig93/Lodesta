"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { parseJsonResponse } from "@/lib/client-json";
import { prospectReportResponseSchema } from "@/packages/acquisition/public-report-contract";

export function WebsiteHealthReportForm({
  buttonLabel = "Check my website",
  className = ""
}: {
  buttonLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const errorId = useId();
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 2) {
      setError("Enter a business name and city, or a website address.");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/prospect-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: value })
      });
      const payload = await parseJsonResponse(response, prospectReportResponseSchema);
      if (!response.ok || !payload.report) {
        throw new Error(payload.error ?? "We could not start this report. Check the business details and try again.");
      }
      router.push(`/website-health-report/${encodeURIComponent(payload.report.id)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not start this report. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form className={`health-search-form ${className}`.trim()} onSubmit={submit} noValidate>
      <label htmlFor={`health-search-${errorId}`}>Business name, city, or website</label>
      <div className="health-search-composer">
        <input
          id={`health-search-${errorId}`}
          name="business"
          type="search"
          value={query}
          maxLength={300}
          autoComplete="organization"
          placeholder="e.g. Oak & Pine Plumbing, Austin"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          disabled={submitting}
          onChange={(event) => {
            setQuery(event.target.value);
            if (error) setError("");
          }}
        />
        <button className="button primary" type="submit" disabled={submitting} aria-busy={submitting}>
          {submitting ? "Finding your business…" : buttonLabel}
        </button>
      </div>
      {error ? <p className="form-error" id={errorId} role="alert">{error}</p> : null}
      <p className="health-search-note">Free report. No generic grade. See what is working and what could improve.</p>
    </form>
  );
}
