import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PreviewWedge } from "@/components/PreviewWedge";
import { AcceptSiteCandidateButton } from "@/components/admin/AcceptSiteCandidateButton";
import { AdminButtonLink } from "@/components/admin/AdminButton";
import { CandidateReviewPane } from "@/components/admin/CandidateReviewPane";
import { CandidateOperatorDecisionForm } from "@/components/admin/CandidateOperatorDecisionForm";
import { CopyIdTag } from "@/components/admin/CopyIdTag";
import { RegenerateCandidateButton } from "@/components/admin/RegenerateCandidateButton";
import { parseAdHocDesignExampleArtifactV1 } from "@/lib/ad-hoc-design-examples";
import { designSystemGateReviewFixtureByCandidateIdV1 } from "@/lib/design-system-gate-review-fixtures-v1";
import {
  latestOperatorDecisionArtifactV1,
  operatorDecisionPassedV1,
  parseOperatorDecisionArtifactV1
} from "@/lib/operator-decision-v1";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository, type SiteCandidateSummary } from "@/lib/repository";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";
import { assertSiteVersionV3, siteVersionV3Issue } from "@/lib/site-version-v3";
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
  const schemaIssue = selectedVersion ? siteVersionV3Issue(selectedVersion) : null;
  const previewAvailable = Boolean(selectedVersion) && !schemaIssue;

  const [candidateArtifacts, queue, runDetail, managedBundle] = await Promise.all([
    repository.listSiteArtifacts({ siteCandidateId: candidate.id }),
    repository.listSiteCandidateSummaries({ status: "ready", limit: 100 }),
    candidate.agentRunId ? repository.getAgentRunDetail(candidate.agentRunId).catch(() => null) : Promise.resolve(null),
    candidate.acceptedSiteId ? repository.getSiteBundle(candidate.acceptedSiteId) : Promise.resolve(null)
  ]);

  const queueNav = buildQueueNav(queue.summaries, candidate.id);
  const designSystemGateFixture = designSystemGateReviewFixtureByCandidateIdV1(candidate.id);
  const operatorDecisionArtifact = latestOperatorDecisionArtifactV1(candidateArtifacts);
  const operatorDecision = operatorDecisionArtifact ? parseOperatorDecisionArtifactV1(operatorDecisionArtifact) : undefined;
  const operatorApproved = operatorDecisionPassedV1(operatorDecision);
  const acceptDisabledReason =
    candidate.status !== "accepted" && schemaIssue
      ? `Stored version schema is stale (${schemaIssue}); run the backfill or regenerate before promotion.`
    : candidate.status !== "accepted" && (candidate.status === "blocked" || readiness !== "ready")
      ? `Candidate QA is ${readiness}; fix blockers before promotion.`
      : candidate.status !== "accepted" && !operatorApproved
      ? "Operator must approve this candidate for outreach before promotion."
      : undefined;

  const qa = selectedVersion?.generationQa;
  const verdictItems = qa
    ? [
        ...qa.blockers.map((blocker) => ({ id: blocker.id, severity: "blocking" as const, title: blocker.title, detail: blocker.detail })),
        ...qa.warnings.map((warning) => ({ id: warning.id, severity: "warning" as const, title: warning.title, detail: warning.detail }))
      ]
    : [];
  const visualQa = qa?.visualQa;
  const siteDossier = bundle.presenceAssessment.siteDossierV1;
  const sourceEvaluation = bundle.presenceAssessment.standardEvaluation;
  const timelineSpans = runDetail ? topLevelSpans(runDetail.spans) : [];
  const designExamples = candidateArtifacts
    .map((artifact) => {
      const payload = parseAdHocDesignExampleArtifactV1(artifact);
      if (!payload) return undefined;
      return {
        artifactId: artifact.id,
        exampleId: payload.exampleId,
        title: payload.title,
        direction: payload.direction,
        mediaMode: payload.mediaMode,
        status: payload.status,
        scores: {
          visualQuality: payload.rubric.visualQuality,
          noMediaCompleteness: payload.rubric.noMediaCompleteness
        }
      };
    })
    .filter((example): example is NonNullable<typeof example> => Boolean(example));

  return (
    <main className="admin-page admin-candidate-detail-page">
      <header className="candidate-review-header">
        <div className="candidate-review-header-left">
          <AdminButtonLink variant="ghost" size="sm" href="/admin/site-candidates">
            ← Queue
          </AdminButtonLink>
          <h1>{candidate.businessName}</h1>
          <CopyIdTag id={candidate.id} />
          <span className={`badge status-${candidate.status}`}>{statusLabel(candidate.status)}</span>
          <span className={`badge candidate-purpose-${candidate.candidatePurpose}`}>{candidate.candidatePurpose === "test_generation" ? "Test generation" : "Prospect"}</span>
          {candidate.sourceUrl ? (
            <a className="candidate-review-source" href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">
              {candidate.sourceHost ?? candidate.sourceUrl}
            </a>
          ) : (
            <span className="candidate-review-source muted">prompt only</span>
          )}
        </div>
        <div className="candidate-review-header-right">
          {designSystemGateFixture ? (
            <AdminButtonLink
              variant="secondary"
              size="sm"
              href={`/admin/site-candidates/${candidate.id}/design-system-review`}
            >
              Compare four ways
            </AdminButtonLink>
          ) : null}
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
            pages={previewAvailable && selectedVersion ? assertSiteVersionV3(selectedVersion, "candidate review version").pageComposition.pages.map((page) => ({ slug: page.slug, title: page.title })) : []}
            designExamples={designExamples}
            previewAvailable={previewAvailable}
            fallbackSlot={<PreviewFallback candidate={candidate} version={selectedVersion} schemaIssue={schemaIssue} />}
            reportSlot={
              previewAvailable ? (
                <PreviewWedge bundle={bundle} />
              ) : (
                <p className="candidate-rail-footnote">Report unavailable until this candidate is regenerated.</p>
              )
            }
          />
        </section>

        <aside className="candidate-review-rail" aria-label="Review evidence and decision">
          <section className="candidate-rail-section">
            <p className="candidate-rail-label">QA verdict</p>
            <span className={`badge ${readinessBadgeClass(readiness)}`}>{readinessLabel(readiness)}</span>
            <div className="candidate-rail-checks">
              <SourceReportScoreRow sourcePercent={sourceEvaluation?.score.percent} />
              {visualQa ? (
                <p className="candidate-rail-check">
                  <span className={`candidate-rail-check-dot ${visualQa.verdict === "ship" ? "is-pass" : visualQa.verdict === "revise" ? "is-fail" : "is-warning"}`} aria-hidden="true" />
                  Visual judgment: {visualQa.verdict.replace("_", " ")} · {visualQa.screenshotCount} screenshots
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

          <section className="candidate-rail-section">
            <p className="candidate-rail-label">Site dossier</p>
            {siteDossier ? (
              <DossierSummary dossier={siteDossier} />
            ) : (
              <p className="candidate-rail-footnote">No dossier cache recorded for this candidate; regenerate to populate it.</p>
            )}
          </section>

          <section className="candidate-rail-section">
            <p className="candidate-rail-label">Operator decision</p>
            <CandidateOperatorDecisionForm
              candidateId={candidate.id}
              initialDecision={operatorDecision}
            />
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

function PreviewFallback({
  candidate,
  version,
  schemaIssue
}: {
  candidate: SiteCandidateRecord;
  version: SiteVersion | undefined;
  schemaIssue: string | null;
}) {
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
  if (version.rendererVersion === "layout-v3" && schemaIssue) {
    return (
      <div className="candidate-review-fallback-copy">
        <span className="badge status-blocked">stale schema</span>
        <h2>Stored version schema is stale</h2>
        <p className="muted">
          This candidate ({candidate.candidateSlug}) was generated before the latest stored-version schema change: {schemaIssue}.
          Run <code>npm run backfill:strip-pages-projection</code> or regenerate the candidate.
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

function DossierSummary({
  dossier
}: {
  dossier: NonNullable<SiteCandidateRecord["bundle"]["presenceAssessment"]["siteDossierV1"]>;
}) {
  const highlights = dossier.sections
    .filter((section) => ["identity", "source-pages", "understanding", "brand-assets"].includes(section.id))
    .slice(0, 4);
  return (
    <div className="candidate-dossier-summary">
      <p className="candidate-rail-footnote">
        {dossier.sourcePageCount} pages · {dossier.proseCharCount.toLocaleString()} prose chars · {dossier.reviewEvidence.length} private review evidence signal{dossier.reviewEvidence.length === 1 ? "" : "s"}
      </p>
      {highlights.map((section) => (
        <details key={section.id} className="candidate-dossier-section">
          <summary>{section.title}</summary>
          <pre>{section.body.slice(0, 1200)}</pre>
        </details>
      ))}
    </div>
  );
}

function SourceReportScoreRow({ sourcePercent }: { sourcePercent?: number }) {
  return (
    <div className="candidate-score-compare">
      <div className="candidate-score-cell is-source">
        <span>Current-site report</span>
        <strong>{typeof sourcePercent === "number" ? sourcePercent : "—"}</strong>
      </div>
      <div className="candidate-score-cell is-generated">
        <span>Generated draft</span>
        <strong>QA above</strong>
      </div>
    </div>
  );
}

function buildQueueNav(readyCandidates: SiteCandidateSummary[], candidateId: string) {
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
  if (!version || siteVersionV3Issue(version)) return 0;
  return assertSiteVersionV3(version, "candidate version").pageComposition.pages.length;
}

function formatDate(input: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(input));
}
