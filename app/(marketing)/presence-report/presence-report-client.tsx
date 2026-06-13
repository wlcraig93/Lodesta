"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

type Suggestion = {
  placeId: string;
  text: string;
};

type PublicReport = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  websiteKind: "owned_website" | "no_website" | "social_or_aggregator";
  sourceUrl?: string;
  sourceHost?: string;
  unlocked: boolean;
  error?: string;
  result?: ReportResult;
};

type ReportResult = {
  generatedAt: string;
  websiteKind: PublicReport["websiteKind"];
  sourceUrl?: string;
  sourceHost?: string;
  overallScore: number;
  overallLabel: string;
  scoreSource: "crawl_standard" | "no_owned_website";
  buckets: Array<{
    id: string;
    label: string;
    score?: number;
    scoredSignals: number;
    status: "scored" | "not_enough_signal";
  }>;
  findings: Array<{
    id: string;
    bucketLabel: string;
    severity: "fail" | "warning";
    title: string;
    consequence: string;
    evidence: string;
    lodestaFix: string;
  }>;
  stages: Array<{
    id: string;
    label: string;
    status: "queued" | "running" | "completed" | "skipped" | "failed";
  }>;
  gatedPlan?: {
    summary: string;
    priorities: Array<{ title: string; detail: string }>;
  };
};

export function PresenceReportClient() {
  const [sessionToken] = useState(() => `prospect_${Math.random().toString(36).slice(2)}_${Date.now()}`);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Suggestion | null>(null);
  const [searchStatus, setSearchStatus] = useState("");
  const [report, setReport] = useState<PublicReport | null>(null);
  const [reportStatus, setReportStatus] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [formRenderedAt, setFormRenderedAt] = useState(Date.now());
  const [leadStatus, setLeadStatus] = useState("");

  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      setSearchStatus("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchStatus("Searching...");
      try {
        const response = await fetch("/api/prospect-reports/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, sessionToken }),
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Search failed");
        setSuggestions(payload.suggestions ?? []);
        setSearchStatus(payload.suggestions?.length ? "" : "No matching businesses found.");
      } catch (error) {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setSearchStatus(error instanceof Error ? error.message : "Search failed");
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, sessionToken]);

  useEffect(() => {
    if (!report || (report.status !== "queued" && report.status !== "running")) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/prospect-reports/${encodeURIComponent(report.id)}`);
      const payload = await response.json();
      if (response.ok && payload.report) setReport(payload.report);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [report]);

  useEffect(() => {
    if (report?.status === "completed") setFormRenderedAt(Date.now());
  }, [report?.status]);

  const canStart = Boolean(selected && !report);
  const headline = selected?.text ?? "Find your business";
  const primaryFinding = report?.result?.findings[0];
  const completedResult = report?.status === "completed" ? report.result : undefined;

  async function startReport() {
    if (!selected) return;
    setReportStatus("Starting scan...");
    setReport(null);
    setLeadStatus("");
    try {
      const response = await fetch("/api/prospect-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: selected.placeId, sessionToken })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to start report");
      setReport(payload.report);
      setReportStatus(payload.reused ? "Using a recent report." : "Scan queued.");
    } catch (error) {
      setReportStatus(error instanceof Error ? error.message : "Unable to start report");
    }
  }

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!report) return;
    setLeadStatus("Unlocking report...");
    const response = await fetch(`/api/prospect-reports/${encodeURIComponent(report.id)}/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: leadEmail,
        contactName: leadName || undefined,
        phone: leadPhone || undefined,
        companyWebsite,
        formRenderedAt,
        metadata: {
          source: "presence_report",
          selectedPlaceId: selected?.placeId ?? ""
        }
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      setLeadStatus(payload.error ?? "Unable to unlock report.");
      return;
    }
    if (payload.report) setReport(payload.report);
    setLeadStatus(payload.ignored ? "Submission ignored." : "Report unlocked.");
  }

  return (
    <main className="presence-report-page">
      <section className="presence-report-hero">
        <div className="presence-report-copy">
          <span className="badge">Public Presence Report</span>
          <h1>{headline}</h1>
          <p>
            See the website and local-presence gaps Lodesta would fix first, using a crawl and browser inspection of the
            business website.
          </p>
        </div>

        <div className="presence-report-search-panel" aria-label="Business search">
          <label>
            <span>Business name</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(null);
                setReport(null);
              }}
              placeholder="Search by business name and city"
              autoComplete="off"
            />
          </label>
          {suggestions.length ? (
            <div className="presence-report-suggestions">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.placeId}
                  type="button"
                  className={selected?.placeId === suggestion.placeId ? "is-selected" : ""}
                  onClick={() => {
                    setSelected(suggestion);
                    setQuery(suggestion.text);
                    setSuggestions([]);
                  }}
                >
                  {suggestion.text}
                </button>
              ))}
              <small>Powered by Google</small>
            </div>
          ) : null}
          {searchStatus ? <p className="form-status">{searchStatus}</p> : null}
          <button className="button primary" type="button" disabled={!canStart} onClick={startReport}>
            Start report
          </button>
          {reportStatus ? <p className="form-status">{reportStatus}</p> : null}
        </div>
      </section>

      {report ? (
        <section className="presence-report-workspace">
          <div className="presence-report-score-panel">
            <span className="badge">{report.status.replace("_", " ")}</span>
            {completedResult ? (
              <>
                <div className="presence-score-value">{completedResult.overallScore}</div>
                <h2>{completedResult.overallLabel}</h2>
                <p>{scoreExplanation(completedResult)}</p>
              </>
            ) : (
              <>
                <div className="presence-score-value pending">--</div>
                <h2>{report.status === "failed" ? "Scan unavailable" : "Scan in progress"}</h2>
                <p>{report.error ?? "This usually takes a couple minutes."}</p>
              </>
            )}
          </div>

          <div className="presence-report-main-panel">
            <StageList stages={report.result?.stages} status={report.status} />
            {completedResult ? (
              <>
                <BucketGrid buckets={completedResult.buckets} />
                <FindingList findings={completedResult.findings} />
                {report.unlocked && completedResult.gatedPlan ? (
                  <GatedPlan plan={completedResult.gatedPlan} />
                ) : (
                  <LeadCapture
                    email={leadEmail}
                    name={leadName}
                    phone={leadPhone}
                    companyWebsite={companyWebsite}
                    status={leadStatus}
                    primaryFinding={primaryFinding?.title}
                    onEmail={setLeadEmail}
                    onName={setLeadName}
                    onPhone={setLeadPhone}
                    onCompanyWebsite={setCompanyWebsite}
                    onSubmit={submitLead}
                  />
                )}
              </>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function StageList({
  stages,
  status
}: {
  stages?: ReportResult["stages"];
  status: PublicReport["status"];
}) {
  const fallback = useMemo(
    () => [
      { id: "place", label: "Business listing selected", status: "completed" as const },
      { id: "scan", label: status === "failed" ? "Scan failed" : "Scan queued", status: status === "failed" ? ("failed" as const) : ("running" as const) }
    ],
    [status]
  );
  return (
    <div className="presence-stage-list">
      {(stages ?? fallback).map((stage) => (
        <span key={stage.id} data-status={stage.status}>
          {stage.label}
        </span>
      ))}
    </div>
  );
}

function BucketGrid({ buckets }: { buckets: ReportResult["buckets"] }) {
  return (
    <div className="presence-bucket-grid">
      {buckets.map((bucket) => (
        <article key={bucket.id}>
          <span>{bucket.label}</span>
          <strong>{bucket.status === "scored" && bucket.score !== undefined ? `${bucket.score}/100` : "Not enough signal"}</strong>
          <small>{bucket.scoredSignals} scored signals</small>
        </article>
      ))}
    </div>
  );
}

function FindingList({ findings }: { findings: ReportResult["findings"] }) {
  return (
    <div className="presence-finding-list">
      <h2>Top findings</h2>
      {findings.map((finding) => (
        <article key={finding.id} className="presence-finding-card">
          <span className={`badge severity-${finding.severity}`}>{finding.bucketLabel}</span>
          <h3>{finding.title}</h3>
          <p>{finding.consequence}</p>
          <small>{finding.evidence}</small>
          <strong>{finding.lodestaFix}</strong>
        </article>
      ))}
    </div>
  );
}

function LeadCapture({
  email,
  name,
  phone,
  companyWebsite,
  status,
  primaryFinding,
  onEmail,
  onName,
  onPhone,
  onCompanyWebsite,
  onSubmit
}: {
  email: string;
  name: string;
  phone: string;
  companyWebsite: string;
  status: string;
  primaryFinding?: string;
  onEmail: (value: string) => void;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
  onCompanyWebsite: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="presence-lead-form" onSubmit={onSubmit}>
      <div>
        <span className="badge">Detailed plan</span>
        <h2>Unlock the fix plan</h2>
        <p>{primaryFinding ? `The first priority is ${primaryFinding.toLowerCase()}.` : "Get the next fixes Lodesta would handle."}</p>
      </div>
      <input
        className="presence-honeypot"
        value={companyWebsite}
        onChange={(event) => onCompanyWebsite(event.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <label>
        <span>Email</span>
        <input type="email" value={email} onChange={(event) => onEmail(event.target.value)} required />
      </label>
      <div className="presence-lead-form-grid">
        <label>
          <span>Name</span>
          <input value={name} onChange={(event) => onName(event.target.value)} />
        </label>
        <label>
          <span>Phone</span>
          <input value={phone} onChange={(event) => onPhone(event.target.value)} />
        </label>
      </div>
      <button className="button primary" type="submit">
        Unlock plan
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}

function GatedPlan({ plan }: { plan: NonNullable<ReportResult["gatedPlan"]> }) {
  return (
    <section className="presence-gated-plan">
      <span className="badge">Unlocked</span>
      <h2>Fix plan</h2>
      <p>{plan.summary}</p>
      <div className="presence-finding-list">
        {plan.priorities.map((priority) => (
          <article key={priority.title} className="presence-finding-card">
            <h3>{priority.title}</h3>
            <p>{priority.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function scoreExplanation(result: ReportResult) {
  if (result.scoreSource === "no_owned_website") {
    return "The listing does not point to an owned website Lodesta can crawl.";
  }
  return "Overall score comes from the crawl Standard. Sub-scores use only the signals the cold scan can measure.";
}
