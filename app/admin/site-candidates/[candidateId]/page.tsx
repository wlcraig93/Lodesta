import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PreviewWedge } from "@/components/PreviewWedge";
import { AcceptSiteCandidateButton } from "@/components/admin/AcceptSiteCandidateButton";
import { AdminButtonLink } from "@/components/admin/AdminButton";
import { CandidateReviewPane } from "@/components/admin/CandidateReviewPane";
import { RegenerateCandidateButton } from "@/components/admin/RegenerateCandidateButton";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";
import { evaluateSiteAgainstStandard } from "@/lib/standard-evaluation";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";
import type {
  AgentRunSpanRecord,
  GenerationQaReadiness,
  SiteCandidateRecord,
  SiteVersion
} from "@/lib/models";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

const MAX_TIMELINE_STEPS = 12;
const MAX_VERDICT_ITEMS = 5;

export default async function AdminSiteCandidateDetailPage({
  params
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const { candidateId } = await params;
  await requireAdminPageAccess(`/admin/site-candidates/${candidateId}`);
  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate) notFound();

  const bundle = candidate.bundle;
  const versions = bundle.siteModel.versions;
  const selectedVersion = versions.find((version) => version.status === "draft") ?? versions[0];
  const readiness: GenerationQaReadiness = selectedVersion
    ? getEffectiveGenerationQaReadiness(bundle, selectedVersion)
    : "unavailable";
  const previewAvailable = Boolean(selectedVersion && selectedVersion.rendererVersion === "layout-v3");

  const [candidateArtifacts, queue, runDetail, managedBundle] = await Promise.all([
    repository.listSiteArtifacts({ siteCandidateId: candidate.id }),
    repository.listSiteCandidates({ status: "ready", limit: 100 }),
    candidate.agentRunId ? repository.getAgentRunDetail(candidate.agentRunId).catch(() => null) : Promise.resolve(null),
    candidate.acceptedSiteId ? repository.getSiteBundle(candidate.acceptedSiteId) : Promise.resolve(null)
  ]);

  const queueNav = buildQueueNav(queue.candidates, candidate.id);
  const acceptDisabledReason =
    candidate.status !== "accepted" && (candidate.status === "blocked" || readiness !== "ready")
      ? `Candidate QA is ${readiness}; fix blockers before promotion.`
      : undefined;

  const qa = selectedVersion?.generationQa;
  const verdictItems = qa
    ? [
        ...qa.blockers.map((blocker) => ({ id: blocker.id, severity: "blocking" as const, title: blocker.title, detail: blocker.detail })),
        ...qa.warnings.map((warning) => ({ id: warning.id, severity: "warning" as const, title: warning.title, detail: warning.detail }))
      ]
    : [];
  const visualQa = qa?.visualQa ?? bundle.presenceAssessment.visualQa;
  const sourceEvaluation = bundle.presenceAssessment.standardEvaluation;
  const replacementEvaluation = evaluateSiteAgainstStandard(bundle);
  const timelineSpans = runDetail ? topLevelSpans(runDetail.spans) : [];

  return (
    <main className="admin-page admin-candidate-detail-page">
      <header className="candidate-review-header">
        <div className="candidate-review-header-left">
          <AdminButtonLink variant="ghost" size="sm" href="/admin/site-candidates">
            ← Queue
          </AdminButtonLink>
          <h1>{candidate.businessName}</h1>
          <span className={`badge status-${candidate.status}`}>{statusLabel(candidate.status)}</span>
          {candidate.sourceUrl ? (
            <a className="candidate-review-source" href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">
              {candidate.sourceHost ?? candidate.sourceUrl}
            </a>
          ) : (
            <span className="candidate-review-source muted">prompt only</span>
          )}
        </div>
        <div className="candidate-review-header-right">
          {queueNav ? (
            <nav className="candidate-review-queue-nav" aria-label="Review queue position">
              {queueNav.previousId ? (
                <Link href={`/admin/site-candidates/${queueNav.previousId}`} aria-label="Previous candidate">
                  ‹
                </Link>
              ) : (
                <span aria-hidden="true">‹</span>
              )}
              <span className="candidate-review-queue-count">
                {queueNav.position} of {queueNav.total}
              </span>
              {queueNav.nextId ? (
                <Link href={`/admin/site-candidates/${queueNav.nextId}`} aria-label="Next candidate">
                  ›
                </Link>
              ) : (
                <span aria-hidden="true">›</span>
              )}
            </nav>
          ) : null}
          <AcceptSiteCandidateButton
            candidateId={candidate.id}
            accepted={candidate.status === "accepted"}
            disabledReason={acceptDisabledReason}
          />
        </div>
      </header>

      <div className="candidate-review-layout">
        <section className="candidate-review-pane" aria-label="Generated artifacts">
          <CandidateReviewPane
            candidateId={candidate.id}
            businessName={candidate.businessName}
            pages={(selectedVersion?.pages ?? []).map((page) => ({ slug: page.slug, title: page.title }))}
            previewAvailable={previewAvailable}
            fallbackSlot={<PreviewFallback candidate={candidate} version={selectedVersion} />}
            reportSlot={<PreviewWedge bundle={bundle} replacementEvaluation={replacementEvaluation} />}
          />
        </section>

        <aside className="candidate-review-rail" aria-label="Review evidence and decision">
          <section className="candidate-rail-section">
            <p className="candidate-rail-label">QA verdict</p>
            <span className={`badge ${readinessBadgeClass(readiness)}`}>{readinessLabel(readiness)}</span>
            <div className="candidate-rail-checks">
              <ScoreCompareRow sourcePercent={sourceEvaluation?.score.percent} generatedPercent={replacementEvaluation.score.percent} />
              {visualQa?.score ? (
                <p className="candidate-rail-check">
                  <span className="candidate-rail-check-dot is-pass" aria-hidden="true" />
                  Visual QA {visualQa.score.overall}/10 · {visualQa.screenshotCount} screenshots
                </p>
              ) : null}
              {verdictItems.slice(0, MAX_VERDICT_ITEMS).map((item) => (
                <p key={item.id} className="candidate-rail-check" title={item.detail}>
                  <span className={`candidate-rail-check-dot ${item.severity === "blocking" ? "is-fail" : "is-warning"}`} aria-hidden="true" />
                  {item.title}
                </p>
              ))}
              {verdictItems.length > MAX_VERDICT_ITEMS ? (
                <p className="candidate-rail-footnote">+{verdictItems.length - MAX_VERDICT_ITEMS} more findings in QA metadata</p>
              ) : null}
              {!qa && !visualQa ? <p className="candidate-rail-footnote">No QA metadata recorded for this candidate.</p> : null}
            </div>
          </section>

          <section className="candidate-rail-section">
            <p className="candidate-rail-label">Agent run</p>
            {timelineSpans.length > 0 ? (
              <>
                <ul className="candidate-run-timeline">
                  {timelineSpans.slice(0, MAX_TIMELINE_STEPS).map((span) => (
                    <li key={span.id} className="candidate-run-step">
                      <span className={`candidate-rail-check-dot ${spanDotClass(span.status)}`} aria-hidden="true" />
                      <span className="candidate-run-step-name">{span.name}</span>
                      <span className="candidate-run-step-duration">{spanDuration(span)}</span>
                    </li>
                  ))}
                </ul>
                {timelineSpans.length > MAX_TIMELINE_STEPS ? (
                  <p className="candidate-rail-footnote">+{timelineSpans.length - MAX_TIMELINE_STEPS} more stages</p>
                ) : null}
              </>
            ) : (
              <p className="candidate-rail-footnote">
                {candidate.agentRunId ? "No stages recorded for this run." : "No agent run is linked to this candidate."}
              </p>
            )}
            {candidate.agentRunId ? (
              <Link className="candidate-rail-link" href={`/admin/runs/${candidate.agentRunId}`}>
                Open full run →
              </Link>
            ) : null}
          </section>

          <section className="candidate-rail-section candidate-rail-meta">
            <p>
              {selectedVersion?.rendererVersion ?? "not compiled"} · {versionPageCount(selectedVersion)} pages ·{" "}
              {candidateArtifacts.length} artifacts
            </p>
            <p>
              created {formatDate(candidate.createdAt)}
              {candidate.acceptedAt ? ` · promoted ${formatDate(candidate.acceptedAt)}` : ""}
            </p>
            <p>
              {managedBundle ? (
                <Link className="candidate-rail-link" href={`/admin/sites/${managedBundle.siteModel.slug}`}>
                  Managed site
                </Link>
              ) : null}
              <a className="candidate-rail-link" href="#candidate-raw-json">
                Raw JSON
              </a>
            </p>
          </section>

          <section className="candidate-rail-section candidate-rail-decision">
            <AcceptSiteCandidateButton
              candidateId={candidate.id}
              accepted={candidate.status === "accepted"}
              disabledReason={acceptDisabledReason}
            />
            {acceptDisabledReason ? <p className="candidate-rail-footnote">{acceptDisabledReason}</p> : null}
            {candidate.sourceUrl ? <RegenerateCandidateButton sourceUrl={candidate.sourceUrl} /> : null}
          </section>
        </aside>
      </div>

      <details id="candidate-raw-json" className="panel candidate-json-details">
        <summary>Raw candidate JSON</summary>
        <pre className="json-block">{JSON.stringify(candidate, null, 2)}</pre>
      </details>
    </main>
  );
}

function PreviewFallback({ candidate, version }: { candidate: SiteCandidateRecord; version: SiteVersion | undefined }) {
  if (!version) {
    return (
      <div className="candidate-review-fallback-copy">
        <span className="badge status-blocked">not compiled</span>
        <h2>No renderable site version</h2>
        <p className="muted">
          This candidate was blocked before a renderable site version was compiled. Review the customer report, QA verdict, and
          agent run to resolve the source facts or policy blockers, then regenerate.
        </p>
      </div>
    );
  }
  return (
    <div className="candidate-review-fallback-copy">
      <span className="badge status-blocked">{version.rendererVersion}</span>
      <h2>Unsupported renderer</h2>
      <p className="muted">
        Candidate previews render layout-v3 only. Regenerate this pre-cutover candidate ({candidate.candidateSlug}) before judging
        customer-site output.
      </p>
    </div>
  );
}

function ScoreCompareRow({ sourcePercent, generatedPercent }: { sourcePercent?: number; generatedPercent: number }) {
  return (
    <div className="candidate-score-compare">
      <div className="candidate-score-cell is-source">
        <span>Current site</span>
        <strong>{typeof sourcePercent === "number" ? sourcePercent : "—"}</strong>
      </div>
      <div className="candidate-score-cell is-generated">
        <span>Generated draft</span>
        <strong>{generatedPercent}</strong>
      </div>
    </div>
  );
}

function buildQueueNav(readyCandidates: SiteCandidateRecord[], candidateId: string) {
  const ordered = [...readyCandidates].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const index = ordered.findIndex((candidate) => candidate.id === candidateId);
  if (index === -1) return null;
  return {
    position: index + 1,
    total: ordered.length,
    previousId: index > 0 ? ordered[index - 1].id : undefined,
    nextId: index < ordered.length - 1 ? ordered[index + 1].id : undefined
  };
}

function topLevelSpans(spans: AgentRunSpanRecord[]) {
  const topLevel = spans.filter((span) => !span.parentSpanId);
  return topLevel.length > 0 ? topLevel : spans;
}

function spanDotClass(status: AgentRunSpanRecord["status"]) {
  if (status === "completed") return "is-pass";
  if (status === "failed" || status === "canceled") return "is-fail";
  return "is-running";
}

function spanDuration(span: AgentRunSpanRecord) {
  if (typeof span.durationMs === "number") return `${Math.max(1, Math.round(span.durationMs / 1000))}s`;
  if (!span.endedAt) return span.status === "running" ? "running" : "—";
  const start = new Date(span.startedAt).getTime();
  const end = new Date(span.endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  return `${Math.max(1, Math.round((end - start) / 1000))}s`;
}

function readinessBadgeClass(readiness: GenerationQaReadiness) {
  if (readiness === "ready") return "status-ready";
  if (readiness === "blocked") return "status-blocked";
  if (readiness === "pending") return "status-pending";
  return "";
}

function readinessLabel(readiness: GenerationQaReadiness) {
  if (readiness === "ready") return "Ready to promote";
  if (readiness === "blocked") return "QA blocked";
  if (readiness === "pending") return "QA pending";
  return "QA unavailable";
}

function statusLabel(status: SiteCandidateRecord["status"]) {
  if (status === "ready") return "needs review";
  if (status === "accepted") return "promoted";
  return status;
}

function versionPageCount(version: SiteVersion | undefined) {
  if (!version) return 0;
  if (version.rendererVersion === "layout-v3") return version.pageComposition.pages.length;
  if (version.rendererVersion === "layout-v2") return version.compiledPages.length;
  return version.pages.length;
}

function formatDate(input: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(input));
}
