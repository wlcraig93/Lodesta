import Link from "next/link";
import type { ReactNode } from "react";
import { AdminButtonLink } from "@/components/admin/AdminButton";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import type { AgentRunRecord, PreviewToken, SiteBundle, SiteVersion, StandardEvaluation } from "@/lib/models";
import { assertSiteVersionV3, firstPageTitleForVersionV3 } from "@/lib/site-version-v3";

export type AdminSiteWorkspaceView = "overview" | "report" | "site" | "qa" | "versions" | "runs";

type AdminSiteWorkspaceShellProps = {
  bundle: SiteBundle;
  view: AdminSiteWorkspaceView;
  selectedVersion: SiteVersion;
  previewToken?: PreviewToken;
  latestRun?: AgentRunRecord;
  sourceEvaluation?: StandardEvaluation;
  generatedEvaluation?: StandardEvaluation;
  children: ReactNode;
};

const viewItems: Array<{ view: AdminSiteWorkspaceView; label: string; detail: string }> = [
  { view: "overview", label: "Overview", detail: "Status and next steps" },
  { view: "report", label: "Source Report", detail: "Crawl and presence" },
  { view: "site", label: "Preview", detail: "Rendered Lodesta site" },
  { view: "qa", label: "QA", detail: "Checks and fixes" },
  { view: "versions", label: "Versions", detail: "Publish and restore" },
  { view: "runs", label: "Activity", detail: "Runs and telemetry" }
];

export function AdminSiteWorkspaceShell({
  bundle,
  view,
  selectedVersion,
  previewToken,
  latestRun,
  sourceEvaluation,
  generatedEvaluation,
  children
}: AdminSiteWorkspaceShellProps) {
  const slug = bundle.siteModel.slug;
  const openFindings = bundle.optimizationFindings.filter((finding) => finding.status === "open").length;

  return (
    <main className="admin-page admin-site-workspace">
      <AdminPageHeader
        className="admin-workspace-header"
        eyebrow="Site workspace"
        title={bundle.businessProfile.name}
        description="Inspect source evidence, previews, QA, versions, and activity from one internal control panel."
        actions={
          <AdminButtonLink variant="secondary" href="/admin/sites">
            All sites
          </AdminButtonLink>
        }
      />

      <div className="admin-workspace-layout">
        <aside className="admin-workspace-sidebar" aria-label={`${bundle.businessProfile.name} workspace controls`}>
          <section className="workspace-sidebar-section">
            <span className="badge">Detected type: {bundle.businessProfile.vertical.replace(/_/g, " ")}</span>
            <h2>{bundle.siteModel.slug}</h2>
            <p className="muted">{bundle.businessProfile.siteId}</p>
          </section>

          <section className="workspace-sidebar-section workspace-status-grid" aria-label="Site status">
            <StatusPill label="Source" value={scoreLabel(sourceEvaluation)} />
            <StatusPill label="Preview" value={scoreLabel(generatedEvaluation)} />
            <StatusPill label="Versions" value={String(bundle.siteModel.versions.length)} />
            <StatusPill label="Open findings" value={String(openFindings)} />
          </section>

          <AdminArtifactNav slug={slug} view={view} selectedVersionId={selectedVersion.id} />

          <section className="workspace-sidebar-section">
            <h2>Versions</h2>
            <div className="workspace-version-list">
              {[...bundle.siteModel.versions]
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
                .map((version) => (
                  <Link
                    key={version.id}
                    className={version.id === selectedVersion.id && view === "site" ? "workspace-version is-active" : "workspace-version"}
                    href={workspaceHref(slug, "site", version.id)}
                  >
                    <span>{version.status}</span>
                    <strong>{firstPageTitleForVersionV3(assertSiteVersionV3(version, "workspace version"))}</strong>
                    <small>{formatDate(version.createdAt)}</small>
                  </Link>
                ))}
            </div>
          </section>

          <section className="workspace-sidebar-section">
            <h2>Actions</h2>
            <div className="workspace-action-list">
              <AdminButtonLink variant="secondary" href={workspaceHref(slug, "site", selectedVersion.id)}>
                View preview
              </AdminButtonLink>
              <AdminButtonLink variant="secondary" href={`/editor/${slug}`}>
                Open editor
              </AdminButtonLink>
              <AdminButtonLink variant="secondary" href={`/sites/${slug}`}>
                Open public site
              </AdminButtonLink>
              {previewToken ? (
                <AdminButtonLink variant="secondary" href={`/preview/${previewToken.token}?artifact=site`}>
                  Open review packet
                </AdminButtonLink>
              ) : null}
              <AdminButtonLink variant="secondary" href={workspaceHref(slug, "runs")}>
                View activity
              </AdminButtonLink>
              {latestRun ? (
                <AdminButtonLink variant="secondary" href={`/admin/runs/${latestRun.id}`}>
                  Inspect latest activity
                </AdminButtonLink>
              ) : null}
            </div>
          </section>
        </aside>

        <section className="admin-workspace-content" aria-label={`${activeViewLabel(view)} view`}>
          {children}
        </section>
      </div>
    </main>
  );
}

export function AdminArtifactNav({
  slug,
  view,
  selectedVersionId
}: {
  slug: string;
  view: AdminSiteWorkspaceView;
  selectedVersionId: string;
}) {
  return (
    <nav className="workspace-sidebar-section workspace-nav" aria-label="Workspace views">
      {viewItems.map((item) => (
        <Link
          key={item.view}
          className={item.view === view ? "workspace-nav-item is-active" : "workspace-nav-item"}
          href={workspaceHref(slug, item.view, item.view === "site" ? selectedVersionId : undefined)}
        >
          <strong>{item.label}</strong>
          <span>{item.detail}</span>
        </Link>
      ))}
    </nav>
  );
}

export function workspaceHref(slug: string, view: AdminSiteWorkspaceView, versionId?: string) {
  const params = new URLSearchParams({ view });
  if (view === "site" && versionId) params.set("versionId", versionId);
  return `/admin/sites/${slug}?${params.toString()}`;
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="workspace-status-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function scoreLabel(evaluation?: StandardEvaluation) {
  return evaluation ? `${evaluation.score.percent}/100` : "--";
}

function activeViewLabel(view: AdminSiteWorkspaceView) {
  return viewItems.find((item) => item.view === view)?.label ?? "Workspace";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}
