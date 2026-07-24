"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { parseJsonResponse } from "@/lib/client-json";

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
  schemaVersion: 1;
  kind: "prospect-presence-report";
  generatedAt: string;
  websiteKind: PublicReport["websiteKind"];
  sourceUrl?: string;
  sourceHost?: string;
  assessmentId?: string;
  coverage?: {
    value: number;
    assessedCriteria: number;
    applicableCriteria: number;
    limitations: string[];
  };
  siteUnderstanding: {
    businessName?: string;
    primaryLocation?: string;
    services: string[];
    customerJourneys: string[];
  };
  whatsWorking: Array<{
    id: string;
    dimension: string;
    title: string;
    evidence: string[];
  }>;
  findings: Array<{
    id: string;
    dimension: string;
    severity: "critical" | "major" | "minor" | "advisory";
    status: "fail" | "warning";
    title: string;
    explanation: string;
    businessConsequence: string;
    evidence: string[];
    recommendation: string;
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

const reportResultSchema: z.ZodType<ReportResult> = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("prospect-presence-report"),
  generatedAt: z.string(),
  websiteKind: z.enum(["owned_website", "no_website", "social_or_aggregator"]),
  sourceUrl: z.string().optional(),
  sourceHost: z.string().optional(),
  assessmentId: z.string().optional(),
  coverage: z.object({
    value: z.number(),
    assessedCriteria: z.number(),
    applicableCriteria: z.number(),
    limitations: z.array(z.string())
  }).strict().optional(),
  siteUnderstanding: z.object({
    businessName: z.string().optional(),
    primaryLocation: z.string().optional(),
    services: z.array(z.string()),
    customerJourneys: z.array(z.string())
  }).strict(),
  whatsWorking: z.array(z.object({
    id: z.string(), dimension: z.string(), title: z.string(), evidence: z.array(z.string())
  }).strict()),
  findings: z.array(z.object({
    id: z.string(), dimension: z.string(), severity: z.enum(["critical", "major", "minor", "advisory"]),
    status: z.enum(["fail", "warning"]), title: z.string(), explanation: z.string(),
    businessConsequence: z.string(), evidence: z.array(z.string()), recommendation: z.string()
  }).strict()),
  stages: z.array(z.object({
    id: z.string(), label: z.string(), status: z.enum(["queued", "running", "completed", "skipped", "failed"])
  }).strict()),
  gatedPlan: z.object({
    summary: z.string(), priorities: z.array(z.object({ title: z.string(), detail: z.string() }).strict())
  }).strict().optional()
}).strict();
const publicReportSchema: z.ZodType<PublicReport> = z.object({
  id: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  websiteKind: z.enum(["owned_website", "no_website", "social_or_aggregator"]),
  sourceUrl: z.string().optional(),
  sourceHost: z.string().optional(),
  unlocked: z.boolean(),
  error: z.string().optional(),
  result: reportResultSchema.optional()
}).strict();
const reportResponseSchema = z.object({
  error: z.string().optional(), report: publicReportSchema.optional(), reused: z.boolean().optional(), ignored: z.boolean().optional()
}).passthrough();

export function PresenceReportClient() {
  const [query, setQuery] = useState("");
  const [report, setReport] = useState<PublicReport | null>(null);
  const [reportStatus, setReportStatus] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [formRenderedAt, setFormRenderedAt] = useState(Date.now());
  const [leadStatus, setLeadStatus] = useState("");

  useEffect(() => {
    if (!report || (report.status !== "queued" && report.status !== "running")) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/prospect-reports/${encodeURIComponent(report.id)}`);
      const payload = await parseJsonResponse(response, reportResponseSchema);
      if (response.ok && payload.report) setReport(payload.report);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [report]);

  useEffect(() => {
    if (report?.status === "completed") setFormRenderedAt(Date.now());
  }, [report?.status]);

  const canStart = query.trim().length >= 2 && !report;
  const headline = query.trim() || "Find your business";
  const primaryFinding = report?.result?.findings[0];
  const completedResult = report?.status === "completed" ? report.result : undefined;

  async function startReport() {
    if (query.trim().length < 2) return;
    setReportStatus("Starting scan...");
    setReport(null);
    setLeadStatus("");
    try {
      const response = await fetch("/api/prospect-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() })
      });
      const payload = await parseJsonResponse(response, reportResponseSchema);
      if (!response.ok) throw new Error(payload.error ?? "Unable to start report");
      if (!payload.report) throw new Error("The server returned an invalid report response.");
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
          businessQuery: query.trim()
        }
      })
    });
    const payload = await parseJsonResponse(response, reportResponseSchema);
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
            See specific, evidence-backed website opportunities from a polite crawl and mobile browser inspection.
          </p>
        </div>

        <div className="presence-report-search-panel" aria-label="Business search">
          <label>
            <span>Business name</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setReport(null);
              }}
              placeholder="Business name and city, or website"
              autoComplete="off"
            />
          </label>
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
                <div className="presence-score-value">{completedResult.coverage?.assessedCriteria ?? completedResult.findings.length}</div>
                <h2>Checks with evidence</h2>
                <p>
                  {completedResult.coverage
                    ? `${completedResult.coverage.applicableCriteria} criteria were applicable. Coverage describes what we could verify, not a website grade.`
                    : "No owned website was available to assess."}
                </p>
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
                <Understanding result={completedResult} />
                <WhatsWorking items={completedResult.whatsWorking} />
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
      { id: "business", label: "Business resolved", status: "completed" as const },
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

function Understanding({ result }: { result: ReportResult }) {
  const understanding = result.siteUnderstanding;
  if (!understanding.businessName && !understanding.primaryLocation && !understanding.services.length && !understanding.customerJourneys.length) return null;
  return (
    <div className="presence-bucket-grid">
      <article>
        <span>Business understood</span>
        <strong>{understanding.businessName ?? "Local business"}</strong>
        <small>{understanding.primaryLocation ?? "Location not confidently detected"}</small>
      </article>
      <article>
        <span>Services detected</span>
        <strong>{understanding.services.length || "—"}</strong>
        <small>{understanding.services.slice(0, 3).join(", ") || "No services confidently extracted"}</small>
      </article>
      <article>
        <span>Customer journeys</span>
        <strong>{understanding.customerJourneys.length || "—"}</strong>
        <small>{understanding.customerJourneys.slice(0, 3).join(", ") || "No journey confidently detected"}</small>
      </article>
    </div>
  );
}

function WhatsWorking({ items }: { items: ReportResult["whatsWorking"] }) {
  if (!items.length) return null;
  return (
    <div className="presence-finding-list">
      <h2>What is working</h2>
      {items.slice(0, 4).map((item) => (
        <article key={item.id} className="presence-finding-card">
          <span className="badge">{item.dimension}</span>
          <h3>{item.title}</h3>
          <small>{item.evidence[0]}</small>
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
          <span className={`badge severity-${finding.severity}`}>{finding.dimension} · {finding.severity}</span>
          <h3>{finding.title}</h3>
          <p>{finding.businessConsequence}</p>
          <small>{finding.evidence.join(" ")}</small>
          <strong>{finding.recommendation}</strong>
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
