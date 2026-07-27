"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { isLikelyEmail } from "@/lib/product-format";
import { parseJsonResponse } from "@/lib/client-json";
import {
  prospectReportLeadResponseSchema,
  prospectReportResponseSchema,
  type PublicProspectReport,
  type PublicProspectReportResult,
  type PublicProspectReportTeaser
} from "@/packages/acquisition/public-report-contract";

type Finding = PublicProspectReportResult["findings"][number];
type Lens = {
  id: "findable" | "clear" | "trustworthy" | "easy" | "action";
  title: string;
  description: string;
  findings: Finding[];
};

const lensDefinitions: Array<Omit<Lens, "findings">> = [
  { id: "findable", title: "Findable", description: "Discovery, local relevance, technical SEO, and AI-search readiness." },
  { id: "clear", title: "Clear", description: "Services, locations, positioning, and answer quality." },
  { id: "trustworthy", title: "Trustworthy", description: "Accurate facts, proof, and credible presentation." },
  { id: "easy", title: "Easy to use", description: "Mobile performance, accessibility, and functional integrity." },
  { id: "action", title: "Action-oriented", description: "Calls, forms, bookings, directions, and other conversion paths." }
];

export function WebsiteHealthReportClient({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<PublicProspectReport | null>(null);
  const [loadError, setLoadError] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadStatus, setLeadStatus] = useState("");
  const [emailDeliveryFailed, setEmailDeliveryFailed] = useState(false);
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [formRenderedAt, setFormRenderedAt] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function load() {
      try {
        const hasAccessFragment = window.location.hash.startsWith("#access=");
        const secret = reportAccessSecretFromFragment();
        if (hasAccessFragment) {
          try {
            if (secret) {
              const exchange = await fetch(`/api/prospect-reports/${encodeURIComponent(reportId)}/access`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ secret })
              });
              const exchanged = await parseJsonResponse(exchange, prospectReportResponseSchema);
              if (exchange.ok && exchanged.report) {
                if (!cancelled) {
                  setReport(exchanged.report);
                  setLoadError("");
                }
                return;
              }
            }
            if (!cancelled) setLeadStatus("That access link is invalid or expired. Enter your email to request a new one.");
          } finally {
            window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
          }
        }
        const response = await fetch(`/api/prospect-reports/${encodeURIComponent(reportId)}`, { cache: "no-store" });
        const payload = await parseJsonResponse(response, prospectReportResponseSchema);
        if (!response.ok || !payload.report) throw new Error(payload.error ?? "This report could not be loaded.");
        if (cancelled) return;
        setReport(payload.report);
        setLoadError("");
        if (payload.report.status === "queued" || payload.report.status === "running") {
          timer = window.setTimeout(load, 2000);
        }
      } catch (caught) {
        if (!cancelled) setLoadError(caught instanceof Error ? caught.message : "This report could not be loaded.");
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [reportId]);

  useEffect(() => {
    if (report?.status === "completed") setFormRenderedAt(Date.now());
  }, [report?.status]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitLead();
  }

  async function submitLead() {
    if (!report || leadSubmitting) return;
    setLeadSubmitting(true);
    setLeadStatus("Unlocking your prioritized plan…");
    try {
      const response = await fetch(`/api/prospect-reports/${encodeURIComponent(report.id)}/lead`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: leadEmail,
          companyWebsite: "",
          formRenderedAt,
          metadata: { source: "website_health_report" }
        })
      });
      const payload = await parseJsonResponse(response, prospectReportLeadResponseSchema);
      if (!response.ok || !payload.report) throw new Error(payload.error ?? "The plan could not be unlocked.");
      setReport(payload.report);
      setEmailDeliveryFailed(Boolean(payload.emailDelivery && payload.emailDelivery.status !== "sent"));
      setLeadStatus(
        payload.ignored
          ? "Please try again."
          : payload.emailDelivery?.message ?? "Your complete report is unlocked."
      );
    } catch (caught) {
      setLeadStatus(caught instanceof Error ? caught.message : "The plan could not be unlocked.");
    } finally {
      setLeadSubmitting(false);
    }
  }

  if (loadError && !report) {
    return (
      <main className="health-report-page">
        <section className="health-report-message" role="alert">
          <p className="eyebrow">Website Health Report</p>
          <h1>We could not load this report.</h1>
          <p>{loadError}</p>
          <Link className="button primary" href="/website-health-report">Start a new report</Link>
        </section>
      </main>
    );
  }

  if (!report || report.status === "queued" || report.status === "running") {
    return (
      <main className="health-report-page">
        <section className="health-report-message" role="status" aria-live="polite">
          <p className="eyebrow">Website Health Report</p>
          <h1>{report?.status === "running" ? "Checking the website…" : "Preparing the website check…"}</h1>
          <p>We are collecting evidence across customer experience, visibility, trust, and action paths.</p>
          <ProgressStages result={report?.result} />
        </section>
      </main>
    );
  }

  if (report.status === "failed" || (!report.result && !report.teaser)) {
    return (
      <main className="health-report-page">
        <section className="health-report-message" role="alert">
          <p className="eyebrow">Website Health Report</p>
          <h1>This check could not finish.</h1>
          <p>{report.error ?? "The source may be temporarily unavailable. You can try again with the website address."}</p>
          <Link className="button primary" href="/website-health-report">Try another search</Link>
        </section>
      </main>
    );
  }

  if (!report.result && report.teaser) {
    return (
      <TeaserReport
        report={report}
        teaser={report.teaser}
        email={leadEmail}
        status={leadStatus}
        submitting={leadSubmitting}
        onEmail={setLeadEmail}
        onSubmit={unlock}
      />
    );
  }

  const result = report.result as PublicProspectReportResult;
  const lenses = healthLenses(result);
  const recommendations = dedupeFindings(lenses.flatMap((lens) => lens.findings));
  const limitations = allLimitations(result);
  const onboardingQuery = new URLSearchParams();
  if (report.sourceUrl) onboardingQuery.set("source", report.sourceUrl);
  onboardingQuery.set("reportId", report.id);
  const onboardingHref = `/account/onboarding?${onboardingQuery.toString()}`;

  return (
    <main className="health-report-page">
      <header className="health-report-heading">
        <div>
          <p className="eyebrow">Website Health Report</p>
          <h1>{result.siteUnderstanding.businessName ?? report.sourceHost ?? "Your website"}</h1>
          <p>{report.sourceUrl ? `Evidence collected from ${report.sourceUrl}` : noWebsiteExplanation(report.websiteKind)}</p>
        </div>
        <span className="report-status-positive">Report complete</span>
      </header>

      <section className="health-understanding" aria-labelledby="understood-heading">
        <h2 id="understood-heading">The business and website we understood</h2>
        <div>
          <article><span>Location</span><strong>{result.siteUnderstanding.primaryLocation ?? "Not confidently detected"}</strong></article>
          <article><span>Services</span><strong>{result.siteUnderstanding.services.slice(0, 4).join(", ") || "Not confidently detected"}</strong></article>
          <article><span>Customer paths</span><strong>{result.siteUnderstanding.customerJourneys.slice(0, 4).join(", ") || "Not confidently detected"}</strong></article>
        </div>
      </section>

      <Strengths result={result} />

      <section className="health-lenses" aria-labelledby="lenses-heading">
        <div className="health-section-heading">
          <p className="eyebrow">Five customer-facing lenses</p>
          <h2 id="lenses-heading">What could improve, with the evidence behind it</h2>
        </div>
        {lenses.map((lens, index) => (
          <article className="health-lens" key={lens.id}>
            <header><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{lens.title}</h3><p>{lens.description}</p></div></header>
            {lens.findings.length ? lens.findings.map((finding) => <FindingCard key={finding.id} finding={finding} />) : (
              <p className="health-lens-empty">No evidence-backed improvement was identified in this lens.</p>
            )}
          </article>
        ))}
      </section>

      <section className="health-limitations" aria-labelledby="limitations-heading">
        <p className="eyebrow">Coverage</p>
        <h2 id="limitations-heading">What this check could and could not verify</h2>
        <p>
          {result.coverage
            ? `${result.coverage.assessedCriteria} checks were supported by evidence across ${result.coverage.applicableCriteria} applicable criteria. This is coverage, not a grade.`
            : "No owned website was available for a full website assessment."}
        </p>
        {limitations.length ? <ul>{limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No additional coverage limitations were recorded.</p>}
      </section>

      <section className="health-recommendations" aria-labelledby="recommendations-heading">
        <p className="eyebrow">Top recommendations</p>
        <h2 id="recommendations-heading">Useful next steps, whether or not you use Lodesta</h2>
        <ol>{recommendations.slice(0, 5).map((finding) => <li key={finding.id}><strong>{finding.title}</strong><p>{finding.recommendation}</p></li>)}</ol>
      </section>

      {report.access.granted ? (
        <>
          <PrioritizedPlan plan={result.gatedPlan} />
          <section className="health-implementation-cta">
            <div>
              <p className="eyebrow">Managed implementation</p>
              <h2>Have Lodesta fix this</h2>
              <p>{report.sourceUrl ? "Review a private improved website, request changes in plain language, and publish when ready." : noWebsiteExplanation(report.websiteKind)}</p>
              {leadStatus ? <p className="form-status" role="status" aria-live="polite">{leadStatus}</p> : null}
            </div>
            <div className="health-implementation-actions">
              <Link className="button primary" href={onboardingHref}>Have Lodesta fix this</Link>
              {emailDeliveryFailed ? (
                <button className="button secondary" type="button" onClick={() => {
                  void submitLead();
                }}>
                  Resend access email
                </button>
              ) : null}
            </div>
          </section>
        </>
      ) : (
        <LeadCapture email={leadEmail} status={leadStatus} submitting={leadSubmitting} onEmail={setLeadEmail} onSubmit={unlock} />
      )}
    </main>
  );
}

function TeaserReport({
  report,
  teaser,
  email,
  status,
  submitting,
  onEmail,
  onSubmit
}: {
  report: PublicProspectReport;
  teaser: PublicProspectReportTeaser;
  email: string;
  status: string;
  submitting: boolean;
  onEmail: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const hiddenSummary = teaser.additionalFindingCount > 0
    ? `${teaser.additionalFindingCount} additional evidence-backed ${teaser.additionalFindingCount === 1 ? "finding" : "findings"} and the prioritized plan are in the complete report.`
    : teaser.planAvailable
      ? "The complete report includes coverage detail and a prioritized plan."
      : "The complete report includes the available coverage and maintenance priorities.";
  return (
    <main className="health-report-page">
      <header className="health-report-heading">
        <div>
          <p className="eyebrow">Website Health Report</p>
          <h1>{teaser.siteUnderstanding.businessName ?? report.sourceHost ?? "Your website"}</h1>
          <p>{report.sourceUrl ? `Evidence collected from ${report.sourceUrl}` : noWebsiteExplanation(report.websiteKind)}</p>
        </div>
        <span className="report-status-positive">Report complete</span>
      </header>

      <BusinessUnderstanding understanding={teaser.siteUnderstanding} />

      <section className="health-strengths" aria-labelledby="teaser-strength-heading">
        <p className="eyebrow">What is working</p>
        <h2 id="teaser-strength-heading">Start with the part worth keeping</h2>
        {teaser.strength ? (
          <div>
            <article>
              <span>{teaser.strength.dimension}</span>
              <h3>{teaser.strength.title}</h3>
              <p>{teaser.strength.evidence.join(" ")}</p>
            </article>
          </div>
        ) : <p>We did not collect enough positive evidence to call out a strength confidently.</p>}
      </section>

      <section className="health-lenses health-teaser-finding" aria-labelledby="teaser-finding-heading">
        <div className="health-section-heading">
          <p className="eyebrow">One complete finding</p>
          <h2 id="teaser-finding-heading">
            {teaser.finding ? "An opportunity supported by evidence" : "What the available evidence says"}
          </h2>
        </div>
        {teaser.finding ? <FindingCard finding={teaser.finding} /> : <p>{teaser.maintenanceMessage}</p>}
        <p className="health-teaser-more">{hiddenSummary}</p>
      </section>

      <section className="health-limitations" aria-labelledby="teaser-limitations-heading">
        <p className="eyebrow">Coverage limitations</p>
        <h2 id="teaser-limitations-heading">What this check could not verify</h2>
        {teaser.limitations.length
          ? <ul>{teaser.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
          : <p>No additional coverage limitations were recorded.</p>}
      </section>

      <LeadCapture
        email={email}
        status={status}
        submitting={submitting}
        onEmail={onEmail}
        onSubmit={onSubmit}
      />
    </main>
  );
}

function BusinessUnderstanding({
  understanding
}: {
  understanding: PublicProspectReportResult["siteUnderstanding"];
}) {
  return (
    <section className="health-understanding" aria-labelledby="understood-heading">
      <h2 id="understood-heading">The business and website we understood</h2>
      <div>
        <article><span>Location</span><strong>{understanding.primaryLocation ?? "Not confidently detected"}</strong></article>
        <article><span>Services</span><strong>{understanding.services.slice(0, 4).join(", ") || "Not confidently detected"}</strong></article>
        <article><span>Customer paths</span><strong>{understanding.customerJourneys.slice(0, 4).join(", ") || "Not confidently detected"}</strong></article>
      </div>
    </section>
  );
}

function ProgressStages({ result }: { result?: PublicProspectReportResult }) {
  if (!result?.stages.length) return <div className="health-progress" aria-hidden="true"><span /><span /><span /></div>;
  return <ul className="health-progress-stages">{result.stages.map((stage) => <li key={stage.id} data-status={stage.status}>{stage.label}</li>)}</ul>;
}

function Strengths({ result }: { result: PublicProspectReportResult }) {
  const items = [
    ...result.whatsWorking,
    ...(result.agentReadiness?.verified ?? []).map((item) => ({ ...item, dimension: "AI-search readiness" })),
    ...(result.visualQuality?.strengths ?? []).map((item) => ({ ...item, dimension: "Visual experience" }))
  ];
  return (
    <section className="health-strengths" aria-labelledby="strengths-heading">
      <p className="eyebrow">What is working</p>
      <h2 id="strengths-heading">Start with the parts worth keeping</h2>
      {items.length ? <div>{items.slice(0, 6).map((item) => <article key={item.id}><span>{item.dimension}</span><h3>{item.title}</h3><p>{item.evidence.join(" ")}</p></article>)}</div> : <p>We did not collect enough positive evidence to call out a strength confidently.</p>}
    </section>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div className="health-finding">
      <span className={`health-priority priority-${finding.severity}`}>{priorityLabel(finding)}</span>
      <h4>{finding.title}</h4>
      <p>{finding.explanation}</p>
      <dl>
        <div><dt>Evidence</dt><dd>{finding.evidence.join(" ")}</dd></div>
        <div><dt>Possible consequence</dt><dd>{finding.businessConsequence}</dd></div>
        <div><dt>Recommendation</dt><dd>{finding.recommendation}</dd></div>
      </dl>
    </div>
  );
}

function LeadCapture({ email, status, submitting, onEmail, onSubmit }: {
  email: string;
  status: string;
  submitting: boolean;
  onEmail: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [error, setError] = useState("");
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    if (!isLikelyEmail(email.trim())) {
      event.preventDefault();
      setError(email.trim() ? "Enter a valid email address, like owner@example.com." : "Enter your email address.");
      inputRef.current?.focus();
      return;
    }
    setError("");
    onSubmit(event);
  }
  return (
    <form className="health-lead-capture" onSubmit={submit} noValidate>
      <div><p className="eyebrow">Complete report</p><h2>See the complete report and what to fix first</h2><p>Add your email to unlock the five-lens report and prioritized fix plan. We will also send a secure 30-day access link for another device.</p></div>
      <div>
        <label htmlFor={`health-email-${errorId}`}>Email address</label>
        <div className="health-lead-composer">
          <input ref={inputRef} id={`health-email-${errorId}`} type="email" value={email} autoComplete="email" aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => { onEmail(event.target.value); if (error) setError(""); }} />
          <button className="button primary" type="submit" disabled={submitting}>{submitting ? "Unlocking…" : "Unlock my complete report"}</button>
        </div>
        {error ? <p className="form-error" id={errorId} role="alert">{error}</p> : null}
        {status ? <p className="form-status" role="status" aria-live="polite">{status}</p> : null}
      </div>
    </form>
  );
}

function reportAccessSecretFromFragment() {
  const value = window.location.hash.startsWith("#access=")
    ? window.location.hash.slice("#access=".length)
    : "";
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function PrioritizedPlan({ plan }: { plan: NonNullable<PublicProspectReportResult["gatedPlan"]> }) {
  return (
    <section className="health-prioritized-plan" aria-labelledby="plan-heading">
      <p className="eyebrow">Unlocked</p>
      <h2 id="plan-heading">Your prioritized fix plan</h2>
      <p>{plan.summary}</p>
      <ol>{plan.priorities.map((priority) => <li key={priority.title}><h3>{priority.title}</h3><p>{priority.detail}</p></li>)}</ol>
    </section>
  );
}

function healthLenses(result: PublicProspectReportResult): Lens[] {
  const findings = dedupeFindings([
    ...result.findings,
    ...(result.agentReadiness?.findings ?? []),
    ...(result.visualQuality?.findings ?? [])
  ]);
  return lensDefinitions.map((lens) => ({
    ...lens,
    findings: findings.filter((finding) => lensForFinding(finding) === lens.id)
  }));
}

function dedupeFindings(findings: Finding[]) {
  return [...new Map(findings.map((finding) => [finding.id, finding])).values()];
}

function lensForFinding(finding: Finding): Lens["id"] {
  const value = `${finding.dimension} ${finding.title}`.toLowerCase();
  if (/conversion|call|form|book|direction|contact|action/.test(value)) return "action";
  if (/mobile|accessib|functional|performance|speed|responsive|broken/.test(value)) return "easy";
  if (/trust|visual|proof|review|credib|accurate/.test(value)) return "trustworthy";
  if (/content|service|location|answer|clarity|clear|position/.test(value)) return "clear";
  return "findable";
}

function allLimitations(result: PublicProspectReportResult) {
  return [...new Set([
    ...(result.coverage?.limitations ?? []),
    ...(result.agentReadiness?.coverage.limitations ?? []),
    ...(result.visualQuality?.coverage.limitations ?? [])
  ])];
}

function priorityLabel(finding: Finding) {
  const functionalFailure = /functional|broken|unavailable|not reachable/i.test(`${finding.dimension} ${finding.title}`);
  if (finding.severity === "critical" && functionalFailure) return "Urgent functional issue";
  if (finding.severity === "critical" || finding.severity === "major") return "High priority";
  if (finding.severity === "minor") return "Worth improving";
  return "Opportunity";
}

function noWebsiteExplanation(kind: PublicProspectReport["websiteKind"]) {
  return kind === "social_or_aggregator"
    ? "We found a third-party profile rather than an owned website. You can provide another public source during setup."
    : "We did not find an owned website. You can start with another public source or the business details you have.";
}
