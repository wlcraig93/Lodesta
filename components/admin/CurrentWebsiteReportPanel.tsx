import { AdminButtonAnchor } from "@/components/admin/AdminButton";
import type { SiteBundle, StandardCheckResult, StandardEvaluation } from "@/lib/models";
import { coldUrlCheckableChecks } from "@/lib/standard-evaluation";

export function CurrentWebsiteReportPanel({ bundle }: { bundle: SiteBundle }) {
  const assessment = bundle.presenceAssessment;
  const sourceEvaluation = assessment.standardEvaluation;
  const sourceUrl = assessment.sourceUrl ?? sourceEvaluation?.sourceUrl;
  const failedChecks = topFailedChecks(coldUrlCheckableChecks(sourceEvaluation?.checks ?? []));
  const evidence = assessment.evidenceManifest;
  const renderInspection = assessment.renderInspection;
  const referenceAssets = (assessment.assetInventory ?? []).filter((asset) => asset.rightsStatus === "reference_only");
  const notes = [
    ...assessment.technicalNotes,
    ...assessment.visualNotes,
    ...assessment.brandNotes,
    ...assessment.publicPresenceNotes
  ].slice(0, 10);

  return (
    <div className="workspace-view-stack">
      <section className="panel">
        <div className="section-heading-row">
          <div>
            <span className="badge">Current Website Report</span>
            <h2>Source-site assessment</h2>
            <p className="muted">Crawl, render, facts, and reference-only evidence from the existing public presence.</p>
          </div>
          {sourceUrl ? (
            <AdminButtonAnchor variant="secondary" size="sm" href={sourceUrl}>
              Source URL
            </AdminButtonAnchor>
          ) : null}
        </div>

        <div className="score-compare workspace-score-compare">
          <ScoreCard label="Current-site report" evaluation={sourceEvaluation} emptyLabel="Not scored" />
        </div>
      </section>

      <div className="admin-grid workspace-grid">
        <section className="panel">
          <h2>Current-site gaps</h2>
          <div className="finding-list">
            {failedChecks.length ? (
              failedChecks.map((check) => <StandardCheckCard key={check.criterionId} check={check} />)
            ) : (
              <article className="finding-card compact-card">
                <span className="badge">clear</span>
                <h3>No failed current-site checks are attached</h3>
                <p>Source URL scoring will populate here after crawl-backed intake.</p>
              </article>
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Evidence retained</h2>
          <div className="finding-list">
            {evidence?.items.length ? (
              evidence.items.slice(0, 6).map((item) => (
                <article key={item.id} className="finding-card compact-card">
                  <span className="badge">{item.kind.replaceAll("_", " ")}</span>
                  <h3>{item.publicText ?? item.sourceExcerpt}</h3>
                  <p>{item.source.url}</p>
                </article>
              ))
            ) : (
              <article className="finding-card compact-card">
                <span className="badge">source sparse</span>
                <h3>No verified public evidence was retained</h3>
                <p>The verifier rejected proposed proof or the source did not expose usable evidence.</p>
              </article>
            )}
          </div>
        </section>
      </div>

      <div className="admin-grid workspace-grid">
        <section className="panel">
          <h2>Extracted facts</h2>
          <table className="data-table">
            <tbody>
              <FactRow label="Business" value={bundle.businessProfile.name} />
              <FactRow label="Phone" value={bundle.businessProfile.phone} />
              <FactRow label="Email" value={bundle.businessProfile.email} />
              <FactRow label="Location" value={formatLocation(bundle)} />
              <FactRow label="Services" value={bundle.businessProfile.services.slice(0, 8).join(", ")} />
              <FactRow label="Social links" value={String(bundle.businessProfile.socialLinks.length)} />
              <FactRow label="Booking links" value={String(bundle.businessProfile.bookingLinks.length)} />
              <FactRow label="Ordering links" value={String(bundle.businessProfile.orderingLinks.length)} />
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Render inspection</h2>
          {renderInspection ? (
            <>
              <div className="metric-row compact-metric-row">
                <Metric label="Sections" value={renderInspection.metrics.sectionCount ?? "--"} />
                <Metric label="CTAs" value={renderInspection.metrics.ctaCount ?? "--"} />
                <Metric label="Forms" value={renderInspection.metrics.formCount ?? "--"} />
                <Metric label="Screens" value={renderInspection.screenshots.length} />
              </div>
              <div className="finding-list">
                {renderInspection.findings.slice(0, 6).map((finding) => (
                  <article key={finding.id} className="finding-card compact-card">
                    <span className={`badge severity-${finding.severity}`}>{finding.severity}</span>
                    <h3>{finding.title}</h3>
                    <p>{finding.evidence}</p>
                  </article>
                ))}
              </div>
              {renderInspection.screenshots.length ? (
                <>
                  <h3>Screenshot artifacts</h3>
                  <div className="finding-list">
                    {renderInspection.screenshots.map((screenshot) => (
                      <article key={`${screenshot.viewport}-${screenshot.path ?? screenshot.capturedAt}`} className="finding-card compact-card">
                        <span className="badge">{screenshot.viewport}</span>
                        <h3>
                          {screenshot.width}x{screenshot.height}
                        </h3>
                        <p className="muted">{screenshot.path ?? "No file path stored"}</p>
                      </article>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <p className="muted">No render inspection is attached to this intake yet.</p>
          )}
        </section>
      </div>

      <div className="admin-grid workspace-grid">
        <section className="panel">
          <h2>Assessment notes</h2>
          <div className="presence-note-strip workspace-note-strip">
            {notes.map((note) => (
              <span key={note}>{note}</span>
            ))}
            {notes.length === 0 ? <span>No notes are attached.</span> : null}
          </div>
        </section>

        <section className="panel">
          <h2>Reference-only assets</h2>
          <div className="finding-list">
            {referenceAssets.slice(0, 8).map((asset) => (
              <article key={asset.id} className="finding-card compact-card">
                <span className="badge">{asset.kind}</span>
                <h3>{asset.alt || asset.url || asset.id}</h3>
                <p className="muted">{asset.url ?? "No URL stored"}</p>
              </article>
            ))}
            {referenceAssets.length === 0 ? <p className="muted">No reference-only assets are attached.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function ScoreCard({
  label,
  evaluation,
  emptyLabel = "Not available"
}: {
  label: string;
  evaluation?: StandardEvaluation;
  emptyLabel?: string;
}) {
  const grade = evaluation?.score.grade.replace("_", " ") ?? emptyLabel;
  return (
    <article className="score-card">
      <span>{label}</span>
      <strong>{evaluation ? `${evaluation.score.percent}/100` : "--"}</strong>
      <small>{grade}</small>
    </article>
  );
}

function StandardCheckCard({ check }: { check: StandardCheckResult }) {
  return (
    <article className="finding-card compact-card">
      <span className={`badge severity-${check.severity}`}>{check.severity}</span>
      <h3>{check.title}</h3>
      <p>{check.businessConsequence}</p>
      <small>{check.evidence}</small>
    </article>
  );
}

function FactRow({ label, value }: { label: string; value?: string }) {
  return (
    <tr>
      <th>{label}</th>
      <td>{value || <span className="muted">Unknown</span>}</td>
    </tr>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card compact-metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatLocation(bundle: SiteBundle) {
  const address = bundle.businessProfile.address;
  return [address?.street, address?.city, address?.region, address?.postalCode].filter(Boolean).join(", ");
}

function topFailedChecks(checks: StandardCheckResult[]) {
  return checks
    .filter((check) => !check.passed)
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity))
    .slice(0, 6);
}

function severityRank(severity: StandardCheckResult["severity"]) {
  if (severity === "fail") return 3;
  if (severity === "warning") return 2;
  return 1;
}
