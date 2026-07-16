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
import { GeneratedSiteQaPanel } from "@/components/admin/GeneratedSiteQaPanel";
import { RunBusinessContextRefreshButton } from "@/components/admin/RunBusinessContextRefreshButton";
import { RunBusinessIdentityServiceButton } from "@/components/admin/RunBusinessIdentityServiceButton";
import { RunAssetSelectionButton } from "@/components/admin/RunAssetSelectionButton";
import { RunBrandDirectionButton } from "@/components/admin/RunBrandDirectionButton";
import { RunBrandMarkGenerationButton } from "@/components/admin/RunBrandMarkGenerationButton";
import { RunClaimsPolicyButton } from "@/components/admin/RunClaimsPolicyButton";
import { RunPageOpportunitiesButton } from "@/components/admin/RunPageOpportunitiesButton";
import { RunPerformanceAuditButton } from "@/components/admin/RunPerformanceAuditButton";
import { RunSocialProofButton } from "@/components/admin/RunSocialProofButton";
import { RunStrategyPlanningButton } from "@/components/admin/RunStrategyPlanningButton";
import { SiteVersionsPanel } from "@/components/SiteVersionsPanel";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";
import { runSiteQa } from "@/lib/qa";
import { getEditingVersion } from "@/lib/sample-data";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";
import { claimGateForBundle } from "@/lib/site-publication";
import { siteStandardEvidenceChecks } from "@/lib/standard-evaluation";
import type { AgentRunRecord, SiteArtifactRecord, SiteBundle, SiteVersion, StandardCheckResult } from "@/lib/models";

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

  const [previewTokens, runsResult, managedSiteArtifacts] = await Promise.all([
    repository.listPreviewTokens(bundle.businessProfile.siteId),
    repository.listAgentRuns({
      runType: "site_generation",
      targetType: "site",
      targetId: bundle.businessProfile.siteId,
      limit: view === "runs" ? 25 : 5
    }),
    repository.listSiteArtifacts({
      siteId: bundle.businessProfile.siteId,
      scope: "site_alternative"
    })
  ]);
  const previewToken = previewTokens[0];
  const latestRun = runsResult.runs[0];
  const sourceEvaluation = bundle.presenceAssessment.standardEvaluation;
  const generatedChecks = siteStandardEvidenceChecks(bundle, {
    versionId: selectedVersion.id
  });

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
        generatedChecks,
        runs: runsResult.runs,
        managedSiteArtifacts
      })}
    </AdminSiteWorkspaceShell>
  );
}

async function renderWorkspaceView(input: {
  bundle: SiteBundle;
  view: AdminSiteWorkspaceView;
  selectedVersion: SiteVersion;
  generatedChecks: StandardCheckResult[];
  runs: AgentRunRecord[];
  managedSiteArtifacts: SiteArtifactRecord[];
}) {
  switch (input.view) {
    case "report":
      return <CurrentWebsiteReportPanel bundle={input.bundle} generatedChecks={input.generatedChecks} />;
    case "site":
      return <AdminArtifactFrame bundle={input.bundle} version={input.selectedVersion} />;
    case "qa":
      return <GeneratedSiteQaPanel bundle={input.bundle} version={input.selectedVersion} qa={runSiteQa(input.bundle, { versionId: input.selectedVersion.id })} />;
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
          managedSiteArtifacts={input.managedSiteArtifacts}
        />
      );
  }
}

function OverviewPanel({
  bundle,
  selectedVersion,
  latestRun,
  managedSiteArtifacts
}: {
  bundle: SiteBundle;
  selectedVersion: SiteVersion;
  latestRun?: AgentRunRecord;
  managedSiteArtifacts: SiteArtifactRecord[];
}) {
  const sourceEvaluation = bundle.presenceAssessment.standardEvaluation;
  const openFindings = bundle.optimizationFindings.filter((finding) => finding.status === "open");
  const draftVersion = getEditingVersion(bundle.siteModel);
  const sourceScore = sourceEvaluation ? `${sourceEvaluation.score.percent}/100` : "Not scored";
  const previewReadiness = getEffectiveGenerationQaReadiness(bundle, selectedVersion);

  return (
    <div className="workspace-view-stack">
      <section className="metric-row">
        <Metric label="Current site" value={sourceScore} />
        <Metric label="Preview QA" value={readinessLabel(previewReadiness)} />
        <Metric label="Open findings" value={openFindings.length} />
        <Metric label="Versions" value={bundle.siteModel.versions.length} />
      </section>

      <div className="admin-grid workspace-grid">
        <section className="panel">
          <div className="section-heading-row">
            <div>
              <span className="badge">Operator overview</span>
              <h2>Next best surfaces</h2>
              <p className="muted">Use the source report and preview together, but keep them as separate artifacts.</p>
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
              <p>{openFindings.length ? `${openFindings.length} optimization finding${openFindings.length === 1 ? "" : "s"} need review.` : "No open optimization findings are waiting."}</p>
              <AdminButtonLink variant="secondary" size="sm" href={workspaceHref(bundle.siteModel.slug, "qa")}>
                Open QA
              </AdminButtonLink>
            </article>
            <article className="finding-card">
              <span className="badge">performance</span>
              <h3>Audit performance</h3>
              <p>Record render-inspection performance proxies and field Web Vitals thresholds for post-publish monitoring.</p>
              <RunPerformanceAuditButton siteId={bundle.businessProfile.siteId} versionId={selectedVersion.id} />
            </article>
            <article className="finding-card">
              <span className="badge">strategy</span>
              <h3>Audit site strategy</h3>
              <p>Persist vertical classification, conversion path, and information architecture reports.</p>
              <RunStrategyPlanningButton siteId={bundle.businessProfile.siteId} versionId={selectedVersion.id} />
            </article>
            <article className="finding-card">
              <span className="badge">facts</span>
              <h3>Audit identity and services</h3>
              <p>Reconcile core business identity and produce a source-backed service catalog for rendering decisions.</p>
              <RunBusinessIdentityServiceButton siteId={bundle.businessProfile.siteId} versionId={selectedVersion.id} />
            </article>
            <article className="finding-card">
              <span className="badge">policy</span>
              <h3>Audit claims and policy</h3>
              <p>Persist claim verification and Google Places policy reports before acceptance or refresh work.</p>
              <RunClaimsPolicyButton siteId={bundle.businessProfile.siteId} versionId={selectedVersion.id} />
            </article>
            <article className="finding-card">
              <span className="badge">proof</span>
              <h3>Audit social proof</h3>
              <p>Classify reviews, public profiles, and trust signals into durable, live-only, reference-only, or blocked proof.</p>
              <RunSocialProofButton siteId={bundle.businessProfile.siteId} versionId={selectedVersion.id} />
            </article>
            <article className="finding-card">
              <span className="badge">assets</span>
              <h3>Audit asset selection</h3>
              <p>Choose render-safe media slots and record reference-only artwork as non-public planning material.</p>
              <RunAssetSelectionButton siteId={bundle.businessProfile.siteId} versionId={selectedVersion.id} />
            </article>
            <article className="finding-card">
              <span className="badge">brand</span>
              <h3>Prepare brand direction</h3>
              <p>Extract rights-safe brand cues and store design direction without generating or publishing a logo.</p>
              <RunBrandDirectionButton siteId={bundle.businessProfile.siteId} versionId={selectedVersion.id} />
            </article>
            <article className="finding-card">
              <span className="badge">brand</span>
              <h3>Record brand mark gate</h3>
              <p>Persist the product/legal gate that blocks generated logo or mark output until the approval path exists.</p>
              <RunBrandMarkGenerationButton siteId={bundle.businessProfile.siteId} versionId={selectedVersion.id} />
            </article>
            <article className="finding-card">
              <span className="badge">facts</span>
              <h3>Refresh business context</h3>
              <p>Compare managed business facts with the stored source graph and persist review-only change impact reports.</p>
              <RunBusinessContextRefreshButton siteId={bundle.businessProfile.siteId} versionId={selectedVersion.id} />
            </article>
            <article className="finding-card">
              <span className="badge">strategy</span>
              <h3>Find page opportunities</h3>
              <p>Recommend service, location, and FAQ pages from durable service and service-area facts. Recommendations stay review-only.</p>
              <RunPageOpportunitiesButton siteId={bundle.businessProfile.siteId} versionId={selectedVersion.id} />
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

          <h2>Business context changes</h2>
          <div className="finding-list">
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "change_impact_report").slice(0, 2).map((artifact) => {
              const impacts = artifact.payload.impacts as Array<{ action?: string; rationale?: string; affectedSectionIds?: string[] }> | undefined;
              return (
                <article key={artifact.id} className="finding-card compact-card">
                  <span className="badge">facts</span>
                  <h3>{impacts?.filter((item) => item.action !== "no_action").length ?? 0} material impacts</h3>
                  <p>{impacts?.slice(0, 2).map((item) => item.rationale).filter(Boolean).join(" ") || "Business context impact report is available for review."}</p>
                </article>
              );
            })}
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "change_impact_report").length === 0 ? (
              <p className="muted">No business context impact report yet.</p>
            ) : null}
          </div>

          <h2>Identity and services</h2>
          <div className="finding-list">
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "identity_reconcile_report" || artifact.artifactType === "service_catalog_report").slice(0, 4).map((artifact) => {
              const identity = artifact.payload.identity as Array<{ status?: string }> | undefined;
              const services = artifact.payload.services as Array<{ status?: string }> | undefined;
              return (
                <article key={artifact.id} className="finding-card compact-card">
                  <span className="badge">facts</span>
                  <h3>{artifact.artifactType === "identity_reconcile_report" ? "Identity" : "Services"}</h3>
                  <p>
                    {identity
                      ? `${identity.filter((item) => item.status === "confirmed").length} confirmed fields`
                      : `${services?.filter((item) => item.status === "render_safe").length ?? 0} render-safe services`}
                  </p>
                </article>
              );
            })}
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "identity_reconcile_report" || artifact.artifactType === "service_catalog_report").length === 0 ? (
              <p className="muted">No identity or service catalog reports yet.</p>
            ) : null}
          </div>

          <h2>Brand direction</h2>
          <div className="finding-list">
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "brand_direction_report" || artifact.artifactType === "brand_mark_generation_report").slice(0, 3).map((artifact) => {
              const report = artifact.payload.directionReport as { label?: string; rationale?: string; riskNotes?: string[] } | undefined;
              const markReport = artifact.payload.report as { status?: string; reason?: string } | undefined;
              return (
                <article key={artifact.id} className="finding-card compact-card">
                  <span className="badge">brand</span>
                  <h3>{report?.label ?? markReport?.status?.replace(/_/g, " ") ?? "Brand direction"}</h3>
                  <p>{report?.rationale ?? report?.riskNotes?.[0] ?? markReport?.reason ?? "Brand direction report is available for review."}</p>
                </article>
              );
            })}
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "brand_direction_report" || artifact.artifactType === "brand_mark_generation_report").length === 0 ? (
              <p className="muted">No brand direction report yet.</p>
            ) : null}
          </div>

          <h2>Asset selection</h2>
          <div className="finding-list">
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "asset_selection_report").slice(0, 2).map((artifact) => {
              const selections = artifact.payload.selections as Array<{ slotId?: string; status?: string; reason?: string }> | undefined;
              return (
                <article key={artifact.id} className="finding-card compact-card">
                  <span className="badge">assets</span>
                  <h3>{selections?.filter((item) => item.status === "selected").length ?? 0} selected slots</h3>
                  <p>{selections?.slice(0, 2).map((item) => `${item.slotId}: ${item.status}`).join(", ") || "Asset selection report is available for review."}</p>
                </article>
              );
            })}
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "asset_selection_report").length === 0 ? (
              <p className="muted">No asset selection report yet.</p>
            ) : null}
          </div>

          <h2>Social proof</h2>
          <div className="finding-list">
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "social_proof_report").slice(0, 2).map((artifact) => {
              const scorecard = artifact.payload.scorecard as { totalItems?: number; durableRenderItems?: number; liveOnlyItems?: number; blockingIssues?: number } | undefined;
              const recommendedDisplay = artifact.payload.recommendedDisplay as string | undefined;
              return (
                <article key={artifact.id} className="finding-card compact-card">
                  <span className="badge">proof</span>
                  <h3>{recommendedDisplay?.replace(/_/g, " ") ?? "Social proof"}</h3>
                  <p>{scorecard?.totalItems ?? 0} items, {scorecard?.durableRenderItems ?? 0} durable, {scorecard?.liveOnlyItems ?? 0} live-only, {scorecard?.blockingIssues ?? 0} blockers.</p>
                </article>
              );
            })}
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "social_proof_report").length === 0 ? (
              <p className="muted">No social proof report yet.</p>
            ) : null}
          </div>

          <h2>Claims and policy</h2>
          <div className="finding-list">
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "claim_report" || artifact.artifactType === "policy_report").slice(0, 4).map((artifact) => {
              const status = artifact.payload.status as string | undefined;
              const issues = artifact.payload.issues as Array<{ severity?: string }> | undefined;
              return (
                <article key={artifact.id} className="finding-card compact-card">
                  <span className={`badge status-${status ?? "pending"}`}>{artifact.artifactType === "claim_report" ? "claims" : "policy"}</span>
                  <h3>{status ?? "Report"}</h3>
                  <p>{issues?.filter((item) => item.severity === "blocking").length ?? 0} blockers, {issues?.filter((item) => item.severity === "warning").length ?? 0} warnings.</p>
                </article>
              );
            })}
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "claim_report" || artifact.artifactType === "policy_report").length === 0 ? (
              <p className="muted">No claims or policy reports yet.</p>
            ) : null}
          </div>

          <h2>Performance</h2>
          <div className="finding-list">
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "performance_audit_report").slice(0, 2).map((artifact) => {
              const findings = artifact.payload.findings as Array<{ severity?: string }> | undefined;
              return (
                <article key={artifact.id} className="finding-card compact-card">
                  <span className="badge">performance</span>
                  <h3>{findings?.length ?? 0} findings</h3>
                  <p>{findings?.filter((item) => item.severity === "blocking").length ?? 0} blockers, {findings?.filter((item) => item.severity === "warning").length ?? 0} warnings.</p>
                </article>
              );
            })}
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "performance_audit_report").length === 0 ? (
              <p className="muted">No performance audit report yet.</p>
            ) : null}
          </div>

          <h2>Page opportunities</h2>
          <div className="finding-list">
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "vertical_classification_report" || artifact.artifactType === "conversion_path_report" || artifact.artifactType === "information_architecture_report").slice(0, 3).map((artifact) => {
              const vertical = (artifact.payload.verticalClassification as { selectedVertical?: string } | undefined)?.selectedVertical;
              const goal = (artifact.payload.conversionPath as { primaryGoal?: string } | undefined)?.primaryGoal;
              const pages = (artifact.payload.informationArchitecture as { pages?: unknown[] } | undefined)?.pages?.length;
              return (
                <article key={artifact.id} className="finding-card compact-card">
                  <span className="badge">strategy</span>
                  <h3>{artifact.artifactType.replace(/_/g, " ")}</h3>
                  <p>{vertical ?? goal ?? `${pages ?? 0} pages`}</p>
                </article>
              );
            })}
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "page_opportunity_report").slice(0, 2).map((artifact) => {
              const opportunities = artifact.payload.opportunities as Array<{ title?: string; slug?: string; status?: string }> | undefined;
              return (
                <article key={artifact.id} className="finding-card compact-card">
                  <span className="badge">strategy</span>
                  <h3>{opportunities?.filter((item) => item.status === "candidate").length ?? 0} candidate pages</h3>
                  <p>{opportunities?.slice(0, 3).map((item) => item.slug ?? item.title).filter(Boolean).join(", ") || "Page opportunity report is available for review."}</p>
                </article>
              );
            })}
            {managedSiteArtifacts.filter((artifact) => artifact.artifactType === "page_opportunity_report").length === 0 ? (
              <p className="muted">No page-opportunity report yet.</p>
            ) : null}
          </div>
        </aside>
      </div>
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
