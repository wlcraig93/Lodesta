import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminButtonLink, AdminButtonRow } from "@/components/admin/AdminButton";
import { AdminArtifactFrame } from "@/components/admin/AdminArtifactFrame";
import {
  AdminSiteWorkspaceShell,
  type AdminSiteWorkspaceView,
  workspaceHref
} from "@/components/admin/AdminSiteWorkspaceShell";
import { CurrentWebsiteReportPanel } from "@/components/admin/CurrentWebsiteReportPanel";
import { ControlPlaneChangeReview } from "@/components/admin/ControlPlaneChangeReview";
import { GeneratedSiteQaPanel } from "@/components/admin/GeneratedSiteQaPanel";
import { SiteVersionsPanel } from "@/components/SiteVersionsPanel";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";
import { getEditingVersion } from "@/lib/sample-data";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";
import { claimGateForBundle } from "@/lib/site-publication";
import type { AgentRunRecord, SiteBundle, SiteVersion } from "@/lib/models";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

type AdminSitePageParams = {
  slug: string;
};

type AdminSiteSearchParams = {
  view?: string;
  versionId?: string;
};

const views = new Set<AdminSiteWorkspaceView>(["overview", "report", "site", "qa", "versions", "runs"]);

export default async function AdminSiteWorkspacePage({
  params,
  searchParams
}: {
  params: Promise<AdminSitePageParams>;
  searchParams: Promise<AdminSiteSearchParams>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const view = parseView(query.view);
  await requireAdminPageAccess(`/admin/sites/${slug}`);

  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();

  const selectedVersion = selectedVersionForView(bundle, view, query.versionId);
  if (!selectedVersion) notFound();

  const [previewTokens, runsResult, controlPlane, controlPlaneChanges] = await Promise.all([
    repository.listPreviewTokens(bundle.businessProfile.siteId),
    repository.listAgentRuns({
      runType: "site_generation",
      targetType: "site",
      targetId: bundle.businessProfile.siteId,
      limit: view === "runs" ? 25 : 5
    }),
    repository.getCanonicalControlPlane(bundle.businessProfile.siteId),
    repository.listControlPlaneChangeRequests(bundle.businessProfile.siteId)
  ]);
  const previewToken = previewTokens[0];
  const latestRun = runsResult.runs[0];
  const sourceEvaluation = bundle.presenceAssessment.standardEvaluation;
  return (
    <AdminSiteWorkspaceShell
      bundle={bundle}
      view={view}
      selectedVersion={selectedVersion}
      previewToken={previewToken}
      latestRun={latestRun}
      sourceEvaluation={sourceEvaluation}
    >
      {await renderWorkspaceView({
        bundle,
        view,
        selectedVersion,
        runs: runsResult.runs,
        controlPlane,
        controlPlaneChanges
      })}
    </AdminSiteWorkspaceShell>
  );
}

async function renderWorkspaceView(input: {
  bundle: SiteBundle;
  view: AdminSiteWorkspaceView;
  selectedVersion: SiteVersion;
  runs: AgentRunRecord[];
  controlPlane: Awaited<ReturnType<typeof repository.getCanonicalControlPlane>>;
  controlPlaneChanges: Awaited<ReturnType<typeof repository.listControlPlaneChangeRequests>>;
}) {
  switch (input.view) {
    case "report":
      return <CurrentWebsiteReportPanel bundle={input.bundle} />;
    case "site":
      return <AdminArtifactFrame bundle={input.bundle} version={input.selectedVersion} />;
    case "qa":
      return <GeneratedSiteQaPanel bundle={input.bundle} version={input.selectedVersion} />;
    case "versions": {
      const claims = await repository.listClaims(input.bundle.businessProfile.siteId);
      const claimGate = claimGateForBundle(input.bundle, claims);
      return (
        <section className="panel">
          <div className="section-heading-row">
            <div>
              <span className="badge">Versions</span>
              <h2>Version History</h2>
              <p className="muted">Review generated drafts and rollback safely by making a previous version live.</p>
            </div>
          </div>
          <SiteVersionsPanel
            siteId={input.bundle.businessProfile.siteId}
            versions={input.bundle.siteModel.versions}
            publishDisabled={!claimGate.ok}
            publishDisabledReason={claimGate.ok ? undefined : claimGate.reason}
          />
        </section>
      );
    }
    case "runs":
      return <RunsPanel runs={input.runs} />;
    case "overview":
    default:
      return (
        <OverviewPanel
          bundle={input.bundle}
          selectedVersion={input.selectedVersion}
          latestRun={input.runs[0]}
          controlPlane={input.controlPlane}
          controlPlaneChanges={input.controlPlaneChanges}
        />
      );
  }
}

function OverviewPanel({
  bundle,
  selectedVersion,
  latestRun,
  controlPlane,
  controlPlaneChanges
}: {
  bundle: SiteBundle;
  selectedVersion: SiteVersion;
  latestRun?: AgentRunRecord;
  controlPlane: Awaited<ReturnType<typeof repository.getCanonicalControlPlane>>;
  controlPlaneChanges: Awaited<ReturnType<typeof repository.listControlPlaneChangeRequests>>;
}) {
  const sourceEvaluation = bundle.presenceAssessment.standardEvaluation;
  const pendingEvidence = controlPlane?.state.proof.filter((item) => item.status === "observed").length ?? 0;
  const draftVersion = getEditingVersion(bundle.siteModel);
  const sourceScore = sourceEvaluation ? `${sourceEvaluation.score.percent}/100` : "Not scored";
  const previewReadiness = getEffectiveGenerationQaReadiness(bundle, selectedVersion);

  return (
    <div className="workspace-view-stack">
      <section className="metric-row">
        <Metric label="Current site" value={sourceScore} />
        <Metric label="Preview QA" value={readinessLabel(previewReadiness)} />
        <Metric label="Evidence confirmations" value={pendingEvidence} />
        <Metric label="Versions" value={bundle.siteModel.versions.length} />
      </section>

      <div className="admin-grid workspace-grid">
        <section className="panel">
          <div className="section-heading-row">
            <div>
              <span className="badge">Operator overview</span>
              <h2>Canonical site workflow</h2>
              <p className="muted">Review source truth, the generated preview, and its objective QA state.</p>
            </div>
          </div>
          <div className="finding-list">
            <article className="finding-card">
              <span className="badge">source</span>
              <h3>Review the current website report</h3>
              <p>Check crawl-backed gaps, extracted facts, render notes, and reference-only assets before judging the preview.</p>
              <AdminButtonLink variant="secondary" size="sm" href={workspaceHref(bundle.siteModel.slug, "report")}>
                Open report
              </AdminButtonLink>
            </article>
            <article className="finding-card">
              <span className="badge">preview</span>
              <h3>Inspect the Lodesta version</h3>
              <p>Open the generated site in the right pane and switch versions without leaving the workspace.</p>
              <AdminButtonLink variant="secondary" size="sm" href={workspaceHref(bundle.siteModel.slug, "site", draftVersion.id)}>
                Open generated site
              </AdminButtonLink>
            </article>
            <article className="finding-card">
              <span className="badge">qa</span>
              <h3>Resolve generated-site QA</h3>
              <p>{pendingEvidence ? `${pendingEvidence} source-backed claim${pendingEvidence === 1 ? "" : "s"} need confirmation.` : "No evidence confirmations are waiting."}</p>
              <AdminButtonLink variant="secondary" size="sm" href={workspaceHref(bundle.siteModel.slug, "qa")}>
                Open QA
              </AdminButtonLink>
            </article>
          </div>
        </section>

        <aside className="panel">
          <h2>Latest activity</h2>
          {latestRun ? (
            <article className="finding-card compact-card">
              <span className={`badge status-${latestRun.status}`}>{latestRun.status}</span>
              <h3>{latestRun.outputSummary ?? latestRun.inputSummary ?? latestRun.id}</h3>
              <p className="muted">{formatDuration(latestRun.startedAt, latestRun.endedAt)}</p>
              <AdminButtonRow>
                <AdminButtonLink variant="secondary" size="sm" href={`/admin/runs/${latestRun.id}`}>
                  Inspect activity
                </AdminButtonLink>
                <AdminButtonLink variant="secondary" size="sm" href={workspaceHref(bundle.siteModel.slug, "runs")}>
                  Open activity
                </AdminButtonLink>
              </AdminButtonRow>
            </article>
          ) : (
            <p className="muted">No activity is attached to this site.</p>
          )}

          <h2>Source notes</h2>
          <div className="presence-note-strip workspace-note-strip">
            {[
              ...bundle.presenceAssessment.technicalNotes,
              ...bundle.presenceAssessment.publicPresenceNotes
            ].slice(0, 4).map((note) => (
              <span key={note}>{note}</span>
            ))}
          </div>
        </aside>
      </div>
      <ControlPlaneChangeReview siteId={bundle.businessProfile.siteId} initialChanges={controlPlaneChanges} />
    </div>
  );
}

function RunsPanel({ runs }: { runs: AgentRunRecord[] }) {
  return (
    <section className="panel">
      <div className="section-heading-row">
        <div>
          <span className="badge">Activity</span>
          <h2>Site activity</h2>
          <p className="muted">Recent generation activity attached to this site.</p>
        </div>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Activity</th>
            <th>Source</th>
            <th>Duration</th>
            <th>Tokens</th>
            <th>Started</th>
            <th>Ended</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <span className={`badge status-${run.status}`}>{run.status}</span>
              </td>
              <td>
                <Link href={`/admin/runs/${run.id}`}>{run.outputSummary ?? run.inputSummary ?? run.id}</Link>
                <small>{run.id}</small>
              </td>
              <td>
                {run.source}
                <small>{run.sourceHost ?? "no host"}</small>
              </td>
              <td>{formatDuration(run.startedAt, run.endedAt)}</td>
              <td>{run.tokenTotals?.totalTokens ?? 0}</td>
              <td>{formatDate(run.startedAt)}</td>
              <td>{run.endedAt ? formatDate(run.endedAt) : <span className="muted">In progress</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs.length === 0 ? <p className="muted">No runs are attached to this site.</p> : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function parseView(input: string | undefined): AdminSiteWorkspaceView {
  return input && views.has(input as AdminSiteWorkspaceView) ? (input as AdminSiteWorkspaceView) : "overview";
}

function selectedVersionForView(bundle: SiteBundle, view: AdminSiteWorkspaceView, versionId?: string) {
  if (view === "site" && versionId) {
    return bundle.siteModel.versions.find((version) => version.id === versionId);
  }
  return getEditingVersion(bundle.siteModel);
}

function formatDate(input: string) {
  return new Date(input).toLocaleString();
}

function readinessLabel(readiness: "ready" | "blocked" | "pending" | "unavailable") {
  if (readiness === "ready") return "Ready";
  if (readiness === "blocked") return "Revise";
  if (readiness === "pending") return "Running";
  return "Unavailable";
}

function formatDuration(startedAt: string, endedAt?: string) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unknown";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return `${seconds}s`;
}
