"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { isLikelyEmail } from "@/lib/product-format";
import { parseJsonResponse } from "@/lib/client-json";
import {
  prospectReportLeadResponseSchema,
  prospectReportResponseSchema,
  type PublicProspectReport,
  type PublicProspectReportResult,
  type PublicProspectReportTeaser
} from "@/packages/acquisition/public-report-contract";
import styles from "./website-health-report.module.css";

type Finding = PublicProspectReportResult["findings"][number];
type Strength = PublicProspectReportResult["whatsWorking"][number];

const reportSections = [
  { id: "overview", label: "Overview" },
  { id: "footprint", label: "Site footprint" },
  { id: "findings", label: "Findings" },
  { id: "visual-quality", label: "Visual quality" },
  { id: "search-ai", label: "Search & AI" },
  { id: "coverage", label: "Coverage" },
  { id: "plan", label: "Action plan" }
] as const;

const findingAreas = [
  {
    id: "technical",
    label: "Technical integrity",
    description: "Availability, security, links, navigation, and browser behavior.",
    matches: /business truth|functional integrity/i
  },
  {
    id: "search",
    label: "Search foundations",
    description: "Metadata, structured data, crawl access, and discoverable architecture.",
    matches: /seo|aeo|discoverability/i
  },
  {
    id: "content",
    label: "Content footprint",
    description: "Service depth, location relevance, intent coverage, and useful destinations.",
    matches: /content|intent/i
  },
  {
    id: "experience",
    label: "Mobile experience",
    description: "Responsive behavior, performance, accessibility, and touch usability.",
    matches: /responsive|performance|accessibility/i
  },
  {
    id: "trust",
    label: "Trust and conversion",
    description: "Proof, privacy, contact paths, calls, forms, bookings, and next actions.",
    matches: /trust|conversion/i
  }
] as const;

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
      <ReportMessage eyebrow="Website Health Report" title="We could not load this report." role="alert">
        <p>{loadError}</p>
        <Link className="button primary" href="/website-health-report">Start a new report</Link>
      </ReportMessage>
    );
  }

  if (!report || report.status === "queued" || report.status === "running") {
    return (
      <ReportMessage
        eyebrow="Website Health Report"
        title={report?.status === "running" ? "Checking the website…" : "Preparing the website check…"}
        role="status"
      >
        <p>We are collecting site-wide evidence across architecture, search, mobile, trust, conversion, and visual quality.</p>
        <ProgressStages result={report?.result} />
      </ReportMessage>
    );
  }

  if (report.status === "failed" || (!report.result && !report.teaser)) {
    return (
      <ReportMessage eyebrow="Website Health Report" title="This check could not finish." role="alert">
        <p>{report.error ?? "The source may be temporarily unavailable. You can try again with the website address."}</p>
        <Link className="button primary" href="/website-health-report">Try another search</Link>
      </ReportMessage>
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
  const findings = dedupeFindings(result.findings);
  const topFinding = findings[0];
  const limitations = allLimitations(result);
  const onboardingQuery = new URLSearchParams();
  if (report.sourceUrl) onboardingQuery.set("source", report.sourceUrl);
  onboardingQuery.set("reportId", report.id);
  const onboardingHref = `/account/onboarding?${onboardingQuery.toString()}`;

  return (
    <main className={styles.page}>
      <ReportHeader report={report} result={result} />

      <div className={styles.reportLayout}>
        <ReportContents available={reportSections.filter((section) => {
          if (section.id === "footprint") return Boolean(result.siteInventory);
          if (section.id === "visual-quality") return Boolean(result.visualQuality);
          if (section.id === "search-ai") return Boolean(result.agentReadiness);
          return true;
        })} />

        <div className={styles.reportBody}>
          <section className={styles.section} id="overview" aria-labelledby="overview-heading">
            <SectionHeading
              eyebrow="Executive summary"
              id="overview-heading"
              title="What the evidence says"
              description="A report of observed strengths, improvement opportunities, and what remains unverified—not a generic score."
            />
            <PrioritySummary finding={topFinding} result={result} />
            <BusinessUnderstanding understanding={result.siteUnderstanding} />
            <AuditMap result={result} />
            <Strengths items={result.whatsWorking} />
          </section>

          <SiteFootprint result={result} />

          <section className={styles.section} id="findings" aria-labelledby="findings-heading">
            <SectionHeading
              eyebrow={`${findings.length} evidence-backed ${findings.length === 1 ? "opportunity" : "opportunities"}`}
              id="findings-heading"
              title="Findings, ordered by consequence"
              description="Critical functional failures come first. Advisory observations are kept separate from measured checks."
            />
            <FindingGroups findings={findings} />
          </section>

          {result.visualQuality ? <VisualQuality result={result} /> : null}
          {result.agentReadiness ? <AgentReadiness result={result} /> : null}

          <Coverage result={result} limitations={limitations} />

          <section className={styles.section} id="plan" aria-labelledby="plan-heading">
            {report.access.granted ? (
              <>
                <PrioritizedPlan plan={result.gatedPlan} />
                <ImplementationCta
                  href={onboardingHref}
                  websiteKind={report.websiteKind}
                  sourceUrl={report.sourceUrl}
                  status={leadStatus}
                  emailDeliveryFailed={emailDeliveryFailed}
                  onResend={() => { void submitLead(); }}
                />
              </>
            ) : (
              <LeadCapture
                email={leadEmail}
                status={leadStatus}
                submitting={leadSubmitting}
                onEmail={setLeadEmail}
                onSubmit={unlock}
              />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function ReportHeader({
  report,
  result
}: {
  report: PublicProspectReport;
  result: PublicProspectReportResult;
}) {
  const snapshot = result.snapshot;
  const coveragePercent = Math.round((result.coverage?.siteEvidence ?? 0) * 100);
  return (
    <header className={styles.reportHeader}>
      <div className={styles.headerTopline}>
        <p className={styles.eyebrow}>Website Health Report</p>
        <span className={styles.completeStatus}>Report complete</span>
      </div>
      <div className={styles.headerTitle}>
        <div>
          <h1>{result.siteUnderstanding.businessName ?? report.sourceHost ?? "Your website"}</h1>
          <p>
            {report.sourceUrl
              ? <>Evidence collected from <a href={report.sourceUrl} rel="noreferrer" target="_blank">{displayHost(report.sourceUrl)}</a></>
              : noWebsiteExplanation(report.websiteKind)}
          </p>
        </div>
        <p className={styles.reportDate}>
          <span>Generated</span>
          {formatReportDate(result.generatedAt)}
        </p>
      </div>
      <div className={styles.summaryStrip} aria-label="Report summary">
        <ReportMetric value={snapshot?.verifiedChecks ?? result.whatsWorking.length} label="Verified checks" tone="positive" />
        <ReportMetric value={snapshot?.opportunityChecks ?? result.findings.length} label="Opportunities" tone="attention" />
        <ReportMetric value={snapshot?.unverifiedChecks ?? 0} label="Not verified" tone="neutral" />
        <ReportMetric value={`${coveragePercent}%`} label="Evidence coverage" tone="neutral" />
      </div>
    </header>
  );
}

function ReportMetric({
  value,
  label,
  tone
}: {
  value: number | string;
  label: string;
  tone: "positive" | "attention" | "neutral";
}) {
  return (
    <div className={styles.metric} data-tone={tone}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ReportContents({
  available
}: {
  available: ReadonlyArray<{ id: string; label: string }>;
}) {
  return (
    <nav className={styles.contents} aria-label="Report sections">
      <p>In this report</p>
      <ol>
        {available.map((section, index) => (
          <li key={section.id}>
            <a href={`#${section.id}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {section.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function PrioritySummary({
  finding,
  result
}: {
  finding?: Finding;
  result: PublicProspectReportResult;
}) {
  return (
    <div className={styles.prioritySummary}>
      <div>
        <span>{finding ? "Start here" : "Current position"}</span>
        <h3>{finding?.title ?? "No verified problem led the available evidence"}</h3>
        <p>{finding?.explanation ?? "The report focuses on coverage, strengths, and practical maintenance priorities."}</p>
      </div>
      <dl>
        <div>
          <dt>Why it matters</dt>
          <dd>{finding?.businessConsequence ?? "A healthy site still needs ongoing functional and content maintenance."}</dd>
        </div>
        <div>
          <dt>First move</dt>
          <dd>{finding?.recommendation ?? result.gatedPlan.priorities[0]?.detail ?? "Keep monitoring the website."}</dd>
        </div>
      </dl>
    </div>
  );
}

function BusinessUnderstanding({
  understanding
}: {
  understanding: PublicProspectReportResult["siteUnderstanding"];
}) {
  return (
    <div className={styles.understanding} aria-labelledby="understood-heading">
      <div className={styles.subsectionHeading}>
        <p>Scope understood</p>
        <h3 id="understood-heading">The business context behind the checks</h3>
      </div>
      <dl>
        <div><dt>Location</dt><dd>{understanding.primaryLocation ?? "Not confidently detected"}</dd></div>
        <div><dt>Services</dt><dd>{understanding.services.slice(0, 6).join(", ") || "Not confidently detected"}</dd></div>
        <div><dt>Customer paths</dt><dd>{understanding.customerJourneys.slice(0, 5).join(", ") || "Not confidently detected"}</dd></div>
      </dl>
    </div>
  );
}

function AuditMap({ result }: { result: PublicProspectReportResult }) {
  if (!result.dimensions?.length) return null;
  return (
    <div className={styles.auditMap}>
      <div className={styles.subsectionHeading}>
        <p>Audit map</p>
        <h3>Ten dimensions, with coverage made explicit</h3>
      </div>
      <div className={styles.dimensionList}>
        {result.dimensions.map((dimension) => {
          const total = dimension.verifiedChecks + dimension.opportunityChecks + dimension.unverifiedChecks;
          return (
            <article key={dimension.id} className={styles.dimensionRow}>
              <div>
                <h4>{dimension.label}</h4>
                <p>{dimension.reviewMode === "advisory" ? "Advisory review" : stateLabel(dimension.state)}</p>
              </div>
              <div className={styles.dimensionBar} aria-label={`${dimension.label}: ${dimension.verifiedChecks} verified, ${dimension.opportunityChecks} opportunities, ${dimension.unverifiedChecks} unverified`}>
                {total ? (
                  <>
                    <span className={styles.barVerified} style={{ flexGrow: dimension.verifiedChecks }} />
                    <span className={styles.barOpportunity} style={{ flexGrow: dimension.opportunityChecks }} />
                    <span className={styles.barUnknown} style={{ flexGrow: dimension.unverifiedChecks }} />
                  </>
                ) : <span className={styles.barUnknown} style={{ flexGrow: 1 }} />}
              </div>
              <p className={styles.dimensionCount}>
                {dimension.verifiedChecks} verified · {dimension.opportunityChecks} to improve · {dimension.unverifiedChecks} unverified
              </p>
            </article>
          );
        })}
      </div>
      <div className={styles.legend} aria-label="Audit map legend">
        <span><i data-tone="verified" />Verified</span>
        <span><i data-tone="opportunity" />Opportunity</span>
        <span><i data-tone="unknown" />Unverified</span>
      </div>
    </div>
  );
}

function Strengths({ items }: { items: Strength[] }) {
  return (
    <div className={styles.strengths}>
      <div className={styles.subsectionHeading}>
        <p>What is working</p>
        <h3>Keep these foundations intact</h3>
      </div>
      {items.length ? (
        <div className={styles.strengthList}>
          {items.slice(0, 8).map((item) => (
            <article key={item.id}>
              <span>{item.dimension}</span>
              <h4>{item.title}</h4>
              <p>{item.evidence[0]}</p>
            </article>
          ))}
        </div>
      ) : <p className={styles.emptyState}>The scan did not collect enough positive evidence to call out a strength confidently.</p>}
    </div>
  );
}

function SiteFootprint({ result }: { result: PublicProspectReportResult }) {
  const inventory = result.siteInventory;
  if (!inventory) return null;
  const usefulTypes = inventory.pageTypes.filter((pageType) =>
    pageType.count > 0 || ["service", "location", "proof", "comparison", "editorial"].includes(pageType.id)
  );
  return (
    <section className={styles.section} id="footprint" aria-labelledby="footprint-heading">
      <SectionHeading
        eyebrow="Site footprint"
        id="footprint-heading"
        title="Breadth with substance, not page count for its own sake"
        description="The crawl inventories useful page types and content depth. More pages help only when each serves a real customer intent with specific, non-duplicative information."
      />
      <div className={styles.footprintMetrics}>
        <ReportMetric value={inventory.discoveredUrls} label="URLs discovered" tone="neutral" />
        <ReportMetric value={inventory.assessedPages} label="Pages assessed" tone="positive" />
        <ReportMetric value={inventory.contentDepth.substantivePages} label="Substantive pages" tone="positive" />
        <ReportMetric value={inventory.contentDepth.thinPages} label="Thin pages observed" tone={inventory.contentDepth.thinPages ? "attention" : "neutral"} />
      </div>
      <div className={styles.pageTypeGrid}>
        {usefulTypes.map((pageType) => (
          <article key={pageType.id} data-empty={pageType.count === 0 || undefined}>
            <strong>{pageType.count}</strong>
            <span>{pageType.label}</span>
            {pageType.id === "comparison" && pageType.count === 0
              ? <small>Not automatically a defect; useful only when comparison intent is real.</small>
              : null}
          </article>
        ))}
      </div>
      <div className={styles.scopeNote}>
        <strong>{inventory.assessedPages} of {inventory.discoveredUrls} discovered URLs were assessed.</strong>
        <p>
          {inventory.coverage === "complete"
            ? "The bounded crawl completed across the discovered inventory."
            : "This is a bounded sample. Counts describe the inspected footprint, not every indexed URL."}
        </p>
      </div>
    </section>
  );
}

function FindingGroups({ findings }: { findings: Finding[] }) {
  if (!findings.length) return <p className={styles.emptyState}>No evidence-backed improvement was identified in the available checks.</p>;
  return (
    <div className={styles.findingGroups}>
      {findingAreas.map((area) => {
        const areaFindings = findings.filter((finding) => area.matches.test(finding.dimension));
        if (!areaFindings.length) return null;
        return (
          <section key={area.id} className={styles.findingGroup} aria-labelledby={`finding-group-${area.id}`}>
            <header>
              <p>{areaFindings.length} {areaFindings.length === 1 ? "finding" : "findings"}</p>
              <h3 id={`finding-group-${area.id}`}>{area.label}</h3>
              <span>{area.description}</span>
            </header>
            <div>
              {areaFindings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <article className={styles.finding} data-severity={finding.severity}>
      <header>
        <span className={styles.priority}>{priorityLabel(finding)}</span>
        <span className={styles.findingDimension}>{finding.dimension}</span>
      </header>
      <h4>{finding.title}</h4>
      <p>{finding.explanation}</p>
      <dl className={styles.findingActions}>
        <div><dt>Why it matters</dt><dd>{finding.businessConsequence}</dd></div>
        <div><dt>Recommended move</dt><dd>{finding.recommendation}</dd></div>
      </dl>
      <details className={styles.evidenceDisclosure}>
        <summary>View evidence <span>{finding.evidence.length}</span></summary>
        <ul>{finding.evidence.map((item, index) => <li key={`${finding.id}-${index}`}>{item}</li>)}</ul>
      </details>
    </article>
  );
}

function VisualQuality({ result }: { result: PublicProspectReportResult }) {
  const visual = result.visualQuality;
  if (!visual) return null;
  return (
    <section className={styles.section} id="visual-quality" aria-labelledby="visual-heading">
      <SectionHeading
        eyebrow="Advisory screenshot review"
        id="visual-heading"
        title="Visual and editorial quality"
        description="Sampled desktop and mobile frames are reviewed for hierarchy, typography, composition, imagery, brand coherence, and responsive polish."
      />
      <AdvisorySummary
        assessed={visual.coverage.assessedChecks}
        applicable={visual.coverage.applicableChecks}
        opportunities={visual.findings.length}
        note={visual.note}
      />
      {visual.strengths.length ? (
        <div className={styles.advisoryStrengths}>
          {visual.strengths.map((strength) => (
            <article key={strength.id}>
              <span>{strength.group}</span>
              <h3>{strength.title}</h3>
              <p>{strength.evidence[0]}</p>
            </article>
          ))}
        </div>
      ) : null}
      {visual.findings.length ? (
        <div className={styles.advisoryFindings}>
          {visual.findings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}
        </div>
      ) : (
        <p className={styles.emptyState}>No visual opportunity was returned from the available screenshot evidence.</p>
      )}
      {visual.coverage.limitations.length ? <LimitationsDisclosure items={visual.coverage.limitations} label="Visual-review limitations" /> : null}
    </section>
  );
}

function AgentReadiness({ result }: { result: PublicProspectReportResult }) {
  const agent = result.agentReadiness;
  if (!agent) return null;
  return (
    <section className={styles.section} id="search-ai" aria-labelledby="search-ai-heading">
      <SectionHeading
        eyebrow="SEO, AEO, and agent access"
        id="search-ai-heading"
        title="Can search engines and answer systems use the site?"
        description="This layer separates established crawl and structured-content checks from emerging agent protocols that apply only to specific capabilities."
      />
      <AdvisorySummary
        assessed={agent.coverage.assessedChecks}
        applicable={agent.coverage.applicableChecks}
        opportunities={agent.findings.length}
        note={agent.note}
      />
      {agent.findings.length ? (
        <div className={styles.advisoryFindings}>
          {agent.findings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}
        </div>
      ) : null}
      {agent.verified.length ? (
        <details className={styles.verifiedDisclosure}>
          <summary>View {agent.verified.length} verified search and agent-readiness checks</summary>
          <div>
            {agent.verified.map((item) => (
              <article key={item.id}>
                <span>{item.group}</span>
                <h3>{item.title}</h3>
                <p>{item.evidence[0]}</p>
              </article>
            ))}
          </div>
        </details>
      ) : null}
      {agent.coverage.limitations.length ? <LimitationsDisclosure items={agent.coverage.limitations} label="Search and AI limitations" /> : null}
    </section>
  );
}

function AdvisorySummary({
  assessed,
  applicable,
  opportunities,
  note
}: {
  assessed: number;
  applicable: number;
  opportunities: number;
  note: string;
}) {
  return (
    <div className={styles.advisorySummary}>
      <dl>
        <div><dt>Assessed</dt><dd>{assessed} / {applicable}</dd></div>
        <div><dt>Opportunities</dt><dd>{opportunities}</dd></div>
        <div><dt>Grade impact</dt><dd>None</dd></div>
      </dl>
      <p>{note}</p>
    </div>
  );
}

function Coverage({
  result,
  limitations
}: {
  result: PublicProspectReportResult;
  limitations: string[];
}) {
  return (
    <section className={styles.section} id="coverage" aria-labelledby="coverage-heading">
      <SectionHeading
        eyebrow="Method and limits"
        id="coverage-heading"
        title="Exactly what this report can and cannot claim"
        description="Coverage is disclosed so a missing data source never masquerades as a healthy result."
      />
      <div className={styles.coverageMatrix}>
        <article data-tone="measured">
          <span>Measured</span>
          <h3>Direct site evidence</h3>
          <ul>
            <li>Internal and primary external destinations</li>
            <li>Mobile layout, controls, and browser behavior</li>
            <li>Metadata, crawl access, sitemap, and structured data</li>
            <li>Page-type breadth and first-party content depth</li>
            <li>Automated accessibility and available performance data</li>
          </ul>
        </article>
        <article data-tone="advisory">
          <span>Advisory</span>
          <h3>Judgment with evidence</h3>
          <ul>
            <li>Visual hierarchy and editorial polish</li>
            <li>Answer quality and extractable content</li>
            <li>Proof placement and decision support</li>
            <li>Emerging agent-readiness conventions</li>
          </ul>
        </article>
        <article data-tone="unmeasured">
          <span>Not measured</span>
          <h3>External market performance</h3>
          <ul>
            <li>Live Google rankings and keyword volumes</li>
            <li>Backlinks, authority, and Search Console performance</li>
            <li>Competitor-site or share-of-search benchmarking</li>
            <li>Manual assistive-technology testing</li>
            <li>Completed third-party form or checkout transactions</li>
          </ul>
        </article>
      </div>
      <div className={styles.coverageReadout}>
        <strong>
          {result.coverage
            ? `${result.coverage.assessedCriteria} of ${result.coverage.applicableCriteria} score-eligible checks had site evidence.`
            : "No owned website was available for a full website assessment."}
        </strong>
        <p>This is evidence coverage, not a grade.</p>
      </div>
      {limitations.length ? <LimitationsDisclosure items={limitations} label="All recorded limitations" /> : null}
      {result.methodology ? (
        <details className={styles.methodology}>
          <summary>Methodology identities</summary>
          <dl>
            <div><dt>Producer</dt><dd>{result.methodology.producerIdentity}</dd></div>
            <div><dt>Registry</dt><dd>{result.methodology.registryIdentity}</dd></div>
            <div><dt>Scanner</dt><dd>{result.methodology.scannerIdentity}</dd></div>
            <div><dt>Route selection</dt><dd>{result.methodology.routeSelectionIdentity}</dd></div>
          </dl>
        </details>
      ) : null}
    </section>
  );
}

function LimitationsDisclosure({ items, label }: { items: string[]; label: string }) {
  return (
    <details className={styles.limitations}>
      <summary>{label} <span>{items.length}</span></summary>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </details>
  );
}

function PrioritizedPlan({ plan }: { plan: NonNullable<PublicProspectReportResult["gatedPlan"]> }) {
  return (
    <div className={styles.plan} aria-labelledby="plan-heading">
      <SectionHeading
        eyebrow="Prioritized action plan"
        id="plan-heading"
        title="Fix the most consequential problems first"
        description={plan.summary}
      />
      <ol>
        {plan.priorities.map((priority, index) => (
          <li key={`${priority.title}-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div><h3>{priority.title}</h3><p>{priority.detail}</p></div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ImplementationCta({
  href,
  websiteKind,
  sourceUrl,
  status,
  emailDeliveryFailed,
  onResend
}: {
  href: string;
  websiteKind: PublicProspectReport["websiteKind"];
  sourceUrl?: string;
  status: string;
  emailDeliveryFailed: boolean;
  onResend: () => void;
}) {
  return (
    <div className={styles.implementationCta}>
      <div>
        <p className={styles.eyebrow}>Managed implementation</p>
        <h2>Have Lodesta fix this</h2>
        <p>{sourceUrl ? "Review a private improved website, request changes in plain language, and publish when ready." : noWebsiteExplanation(websiteKind)}</p>
        {status ? <p className="form-status" role="status" aria-live="polite">{status}</p> : null}
      </div>
      <div className={styles.implementationActions}>
        <Link className="button primary" href={href}>Have Lodesta fix this</Link>
        {emailDeliveryFailed ? <button className="button secondary" type="button" onClick={onResend}>Resend access email</button> : null}
      </div>
    </div>
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
    ? `${teaser.additionalFindingCount} additional evidence-backed ${teaser.additionalFindingCount === 1 ? "finding" : "findings"}, the site-footprint review, and the prioritized plan are in the complete report.`
    : teaser.planAvailable
      ? "The complete report includes the audit map, coverage detail, and a prioritized plan."
      : "The complete report includes the available coverage and maintenance priorities.";
  return (
    <main className={styles.page}>
      <header className={styles.teaserHeader}>
        <p className={styles.eyebrow}>Website Health Report</p>
        <span className={styles.completeStatus}>Report complete</span>
        <h1>{teaser.siteUnderstanding.businessName ?? report.sourceHost ?? "Your website"}</h1>
        <p>{report.sourceUrl ? `Evidence collected from ${displayHost(report.sourceUrl)}` : noWebsiteExplanation(report.websiteKind)}</p>
      </header>
      <div className={styles.teaserBody}>
        <BusinessUnderstanding understanding={teaser.siteUnderstanding} />
        <div className={styles.teaserEvidence}>
          <div>
            <p className={styles.eyebrow}>What is working</p>
            <h2>Start with the part worth keeping</h2>
            {teaser.strength ? (
              <article className={styles.teaserStrength}>
                <span>{teaser.strength.dimension}</span>
                <h3>{teaser.strength.title}</h3>
                <p>{teaser.strength.evidence.join(" ")}</p>
              </article>
            ) : <p>We did not collect enough positive evidence to call out a strength confidently.</p>}
          </div>
          <div>
            <p className={styles.eyebrow}>One complete finding</p>
            <h2>{teaser.finding ? "An opportunity supported by evidence" : "What the available evidence says"}</h2>
            {teaser.finding ? <FindingCard finding={teaser.finding} /> : <p>{teaser.maintenanceMessage}</p>}
            <p className={styles.teaserMore}>{hiddenSummary}</p>
          </div>
        </div>
        {teaser.limitations.length ? <LimitationsDisclosure items={teaser.limitations} label="Coverage limitations" /> : null}
        <LeadCapture email={email} status={status} submitting={submitting} onEmail={onEmail} onSubmit={onSubmit} />
      </div>
    </main>
  );
}

function ProgressStages({ result }: { result?: PublicProspectReportResult }) {
  if (!result?.stages.length) return <div className={styles.progress} aria-hidden="true"><span /><span /><span /></div>;
  return (
    <ul className={styles.progressStages}>
      {result.stages.map((stage) => <li key={stage.id} data-status={stage.status}>{stage.label}</li>)}
    </ul>
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
    <form className={styles.leadCapture} onSubmit={submit} noValidate>
      <div>
        <p className={styles.eyebrow}>Complete report</p>
        <h2>See the complete report and what to fix first</h2>
        <p>Add your email to unlock the audit map, site-footprint review, full findings, and prioritized plan. We will also send a secure 30-day access link.</p>
      </div>
      <div>
        <label htmlFor={`health-email-${errorId}`}>Email address</label>
        <div className={styles.leadComposer}>
          <input
            ref={inputRef}
            id={`health-email-${errorId}`}
            type="email"
            value={email}
            autoComplete="email"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              onEmail(event.target.value);
              if (error) setError("");
            }}
          />
          <button className="button primary" type="submit" disabled={submitting}>{submitting ? "Unlocking…" : "Unlock my complete report"}</button>
        </div>
        {error ? <p className="form-error" id={errorId} role="alert">{error}</p> : null}
        {status ? <p className="form-status" role="status" aria-live="polite">{status}</p> : null}
      </div>
    </form>
  );
}

function SectionHeading({
  eyebrow,
  id,
  title,
  description
}: {
  eyebrow: string;
  id: string;
  title: string;
  description?: string;
}) {
  return (
    <header className={styles.sectionHeading}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      {description ? <p>{description}</p> : null}
    </header>
  );
}

function ReportMessage({
  eyebrow,
  title,
  role,
  children
}: {
  eyebrow: string;
  title: string;
  role: "alert" | "status";
  children: ReactNode;
}) {
  return (
    <main className={styles.messagePage}>
      <section className={styles.message} role={role} aria-live={role === "status" ? "polite" : undefined}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
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

function dedupeFindings(findings: Finding[]) {
  return [...new Map(findings.map((finding) => [finding.id, finding])).values()]
    .sort((left, right) =>
      severityRank(left.severity) - severityRank(right.severity)
      || statusRank(left.status) - statusRank(right.status)
      || left.title.localeCompare(right.title)
    );
}

function allLimitations(result: PublicProspectReportResult) {
  return [...new Set([
    ...(result.coverage?.limitations ?? []),
    ...(result.visualQuality?.coverage.limitations ?? []),
    ...(result.agentReadiness?.coverage.limitations ?? [])
  ])];
}

function priorityLabel(finding: Finding) {
  const functionalFailure = /functional|broken|unavailable|not reachable/i.test(`${finding.dimension} ${finding.title}`);
  if (finding.status === "fail" && finding.severity === "critical" && functionalFailure) return "Urgent functional issue";
  if (finding.severity === "critical" || finding.severity === "major") return "High priority";
  if (finding.severity === "minor") return "Worth improving";
  return "Advisory";
}

function severityRank(severity: Finding["severity"]) {
  return { critical: 0, major: 1, minor: 2, advisory: 3 }[severity];
}

function statusRank(status: Finding["status"]) {
  return status === "fail" ? 0 : 1;
}

function stateLabel(state: NonNullable<PublicProspectReportResult["dimensions"]>[number]["state"]) {
  return {
    scored: "Measured",
    not_yet_scored: "Advisory only",
    insufficient_evidence: "Evidence limited",
    not_applicable: "Not applicable"
  }[state];
}

function displayHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function formatReportDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function noWebsiteExplanation(kind: PublicProspectReport["websiteKind"]) {
  return kind === "social_or_aggregator"
    ? "We found a third-party profile rather than an owned website. You can provide another public source during setup."
    : "We did not find an owned website. You can start with another public source or the business details you have.";
}
