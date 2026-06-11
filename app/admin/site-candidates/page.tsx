import Link from "next/link";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { CandidatePreviewThumb } from "@/components/admin/CandidatePreviewThumb";
import { QueueAutoRefresh } from "@/components/admin/QueueAutoRefresh";
import { SiteCandidateCreateDialog } from "@/components/admin/SiteCandidateCreateDialog";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";
import type { AgentRunSpanRecord, GenerationQaReadiness, JobRecord, SiteCandidateRecord } from "@/lib/models";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

type QueueView = "review" | "generating" | "blocked" | "accepted";

type GeneratingCard = {
  job: JobRecord;
  title: string;
  sourceHost?: string;
  runId?: string;
  currentStage?: string;
  completedStageCount: number;
};

export default async function AdminSiteCandidatesPage({
  searchParams
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  await requireAdminPageAccess("/admin/site-candidates");
  const { view: viewParam } = await searchParams;
  const view = parseView(viewParam);

  const [result, queuedJobs, runningJobs] = await Promise.all([
    repository.listSiteCandidates({ limit: 100 }),
    repository.listJobs("queued"),
    repository.listJobs("running")
  ]);

  const candidates = result.candidates.filter((candidate) => candidate.status !== "archived");
  const activeJobs = [...runningJobs, ...queuedJobs].filter((job) => job.kind === "generate_site");
  const generatingCards = await Promise.all(activeJobs.map(loadGeneratingCard));

  const readinessById = new Map<string, GenerationQaReadiness>(
    candidates.map((candidate) => [candidate.id, candidateReadiness(candidate)])
  );
  const reviewCandidates = candidates
    .filter((candidate) => candidate.status === "ready")
    .sort(byUpdatedDesc);
  const blockedCandidates = candidates
    .filter((candidate) => candidate.status === "blocked")
    .sort(byUpdatedDesc);
  const acceptedCandidates = candidates
    .filter((candidate) => candidate.status === "accepted")
    .sort((left, right) => (right.acceptedAt ?? right.updatedAt).localeCompare(left.acceptedAt ?? left.updatedAt));

  const filters: { view: QueueView; label: string; count: number }[] = [
    { view: "review", label: "Needs review", count: reviewCandidates.length },
    { view: "generating", label: "Generating", count: generatingCards.length },
    { view: "blocked", label: "Blocked", count: blockedCandidates.length },
    { view: "accepted", label: "Promoted", count: acceptedCandidates.length }
  ];

  const visibleCandidates =
    view === "review" ? reviewCandidates : view === "blocked" ? blockedCandidates : view === "accepted" ? acceptedCandidates : [];
  const visibleGenerating = view === "review" || view === "generating" ? generatingCards : [];

  return (
    <main className="admin-page">
      <QueueAutoRefresh enabled={generatingCards.length > 0} />
      <AdminPageHeader
        eyebrow="Build"
        title="Site candidates"
        description={queueSummary(reviewCandidates.length, generatingCards.length)}
        actions={<SiteCandidateCreateDialog />}
      />

      <nav className="candidate-queue-filter" aria-label="Candidate queue filters">
        {filters.map((filter) => (
          <Link
            key={filter.view}
            href={filter.view === "review" ? "/admin/site-candidates" : `/admin/site-candidates?view=${filter.view}`}
            className={filter.view === view ? "is-active" : ""}
            aria-current={filter.view === view ? "page" : undefined}
          >
            {filter.label}
            <span>{filter.count}</span>
          </Link>
        ))}
      </nav>

      {visibleGenerating.length > 0 || visibleCandidates.length > 0 ? (
        <div className="candidate-grid">
          {visibleGenerating.map((card) => (
            <GeneratingCandidateCard key={card.job.id} card={card} />
          ))}
          {visibleCandidates.map((candidate) => (
            <CandidateCard key={candidate.id} candidate={candidate} readiness={readinessById.get(candidate.id) ?? "unavailable"} />
          ))}
        </div>
      ) : (
        <p className="candidate-queue-empty muted">{emptyLabel(view)}</p>
      )}
    </main>
  );
}

function CandidateCard({ candidate, readiness }: { candidate: SiteCandidateRecord; readiness: GenerationQaReadiness }) {
  const hasRenderableVersion = candidate.bundle.siteModel.versions.length > 0;

  return (
    <article className="candidate-card">
      <Link
        className="candidate-card-link"
        href={`/admin/site-candidates/${candidate.id}`}
        aria-label={`Review ${candidate.businessName}`}
      />
      <div className="candidate-card-media">
        {hasRenderableVersion ? (
          <CandidatePreviewThumb src={`/site-candidate-previews/${candidate.id}`} title={`${candidate.businessName} preview`} />
        ) : (
          <div className="candidate-card-media-empty">
            <span>Not compiled</span>
          </div>
        )}
      </div>
      <div className="candidate-card-body">
        <div className="candidate-card-title-row">
          <h3>{candidate.businessName}</h3>
          <ReadinessBadge candidate={candidate} readiness={readiness} />
        </div>
        <p className="candidate-card-meta">
          {candidate.vertical.replace(/_/g, " ")} · {candidate.sourceHost ?? sourceHost(candidate.sourceUrl) ?? "prompt only"} ·{" "}
          {timeAgo(candidate.updatedAt)}
        </p>
      </div>
    </article>
  );
}

function GeneratingCandidateCard({ card }: { card: GeneratingCard }) {
  return (
    <article className="candidate-card candidate-card-generating">
      {card.runId ? (
        <Link className="candidate-card-link" href={`/admin/runs/${card.runId}`} aria-label={`Generation activity for ${card.title}`} />
      ) : null}
      <div className="candidate-card-media candidate-card-media-generating">
        <span className="loading-spinner" aria-hidden="true" />
        {card.currentStage ? (
          <p className="candidate-stage-current">
            {card.currentStage}
            {card.completedStageCount > 0 ? <span> · stage {card.completedStageCount + 1}</span> : null}
          </p>
        ) : (
          <p className="candidate-stage-current">{card.job.status === "queued" ? "Waiting for worker" : "Starting generation"}</p>
        )}
      </div>
      <div className="candidate-card-body">
        <div className="candidate-card-title-row">
          <h3>{card.title}</h3>
          <span className="badge status-running">generating</span>
        </div>
        <p className="candidate-card-meta">
          {card.sourceHost ?? "prompt only"} · queued {timeAgo(card.job.createdAt)}
          {card.job.attempts > 1 ? ` · attempt ${card.job.attempts}/${card.job.maxAttempts}` : ""}
        </p>
      </div>
    </article>
  );
}

function ReadinessBadge({ candidate, readiness }: { candidate: SiteCandidateRecord; readiness: GenerationQaReadiness }) {
  if (candidate.status === "accepted") return <span className="badge status-published">promoted</span>;
  if (candidate.status === "blocked") return <span className="badge status-blocked">blocked</span>;
  if (readiness === "ready") return <span className="badge status-ready">QA ready</span>;
  if (readiness === "blocked") return <span className="badge status-blocked">QA blocked</span>;
  if (readiness === "pending") return <span className="badge status-pending">QA pending</span>;
  return <span className="badge">no QA</span>;
}

async function loadGeneratingCard(job: JobRecord): Promise<GeneratingCard> {
  const url = stringField(job.payload, "url");
  const prompt = stringField(job.payload, "prompt");
  const runId = stringField(job.result, "runId");
  let currentStage: string | undefined;
  let completedStageCount = 0;

  if (runId) {
    const detail = await repository.getAgentRunDetail(runId).catch(() => null);
    if (detail && detail.spans.length > 0) {
      const currentSpan = pickCurrentSpan(detail.spans);
      currentStage = currentSpan?.name;
      completedStageCount = detail.spans.filter((span) => span.status === "completed").length;
    }
  }

  return {
    job,
    title: sourceHost(url) ?? prompt ?? "New candidate",
    sourceHost: sourceHost(url),
    runId: runId ?? undefined,
    currentStage,
    completedStageCount
  };
}

function pickCurrentSpan(spans: AgentRunSpanRecord[]) {
  const running = spans.filter((span) => span.status === "running");
  if (running.length > 0) return running[running.length - 1];
  return spans[spans.length - 1];
}

function candidateReadiness(candidate: SiteCandidateRecord): GenerationQaReadiness {
  const versions = candidate.bundle.siteModel.versions;
  const version = versions.find((candidateVersion) => candidateVersion.status === "draft") ?? versions[0];
  return version ? getEffectiveGenerationQaReadiness(candidate.bundle, version) : "unavailable";
}

function queueSummary(reviewCount: number, generatingCount: number) {
  const parts: string[] = [];
  parts.push(reviewCount === 0 ? "Nothing waiting on your review" : `${reviewCount} waiting on your review`);
  if (generatingCount > 0) parts.push(`${generatingCount} generating`);
  return parts.join(" · ");
}

function emptyLabel(view: QueueView) {
  if (view === "review") return "No candidates need review. Create one to get started.";
  if (view === "generating") return "No generation jobs are queued or running.";
  if (view === "blocked") return "No blocked candidates.";
  return "No promoted candidates yet.";
}

function byUpdatedDesc(left: SiteCandidateRecord, right: SiteCandidateRecord) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function parseView(input: string | undefined): QueueView {
  if (input === "generating" || input === "blocked" || input === "accepted") return input;
  return "review";
}

function stringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function sourceHost(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function timeAgo(input: string) {
  const then = new Date(input).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
