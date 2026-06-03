import Link from "next/link";
import type { Metadata } from "next";
import { AdminButtonLink, AdminButtonRow } from "@/components/admin/AdminButton";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getEditingVersion } from "@/lib/sample-data";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

export default async function AdminSitesPage() {
  await requireAdminPageAccess("/admin/sites");
  const [sites, runs] = await Promise.all([
    repository.listSiteBundles(),
    repository.listAgentRuns({ runType: "site_generation", targetType: "site", limit: 100 })
  ]);
  const latestRunBySite = new Map<string, (typeof runs.runs)[number]>();
  for (const run of runs.runs) {
    if (run.targetId && !latestRunBySite.has(run.targetId)) latestRunBySite.set(run.targetId, run);
  }

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Managed inventory"
        title="Sites"
        description="Open durable managed sites for editing, claiming, preview tokens, publishing, billing, and domains."
        actions={
          <AdminButtonLink variant="primary" href="/admin/generate">
            Generate
          </AdminButtonLink>
        }
      />

      <section className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Business</th>
              <th>Source</th>
              <th>Last Activity</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((bundle) => {
              const siteId = bundle.businessProfile.siteId;
              const run = latestRunBySite.get(siteId);
              const sourceUrl = bundle.presenceAssessment.sourceUrl ?? bundle.presenceAssessment.standardEvaluation?.sourceUrl ?? run?.sourceUrl;
              const editingVersion = getEditingVersion(bundle.siteModel);
              const lastActivity = run
                ? {
                    label: run.status,
                    detail: `Updated ${formatDate(run.updatedAt)}`
                  }
                : {
                    label: "Latest version",
                    detail: `Created ${formatDate(latestVersionCreatedAt(bundle.siteModel.versions))}`
                  };
              return (
                <tr key={siteId}>
                  <td>
                    {bundle.businessProfile.name}
                    <small>{bundle.siteModel.slug}</small>
                    <span className="badge sites-detected-type">
                      Detected type: {bundle.businessProfile.vertical.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td>
                    {sourceUrl ? (
                      <a href={sourceUrl}>{sourceHost(sourceUrl)}</a>
                    ) : (
                      <span className="muted">No source URL</span>
                    )}
                    <small>{bundle.siteModel.versions[0]?.pages.length ?? 0} generated pages</small>
                  </td>
                  <td>
                    <span className={`badge ${run ? `status-${run.status}` : ""}`}>{lastActivity.label}</span>
                    <small>{lastActivity.detail}</small>
                  </td>
                  <td>
                    <AdminButtonRow>
                      <AdminButtonLink variant="primary" size="sm" href={`/admin/sites/${bundle.siteModel.slug}`}>
                        Manage
                      </AdminButtonLink>
                      <AdminButtonLink variant="secondary" size="sm" href={`/admin/sites/${bundle.siteModel.slug}?view=report`}>
                        Report
                      </AdminButtonLink>
                      <AdminButtonLink
                        variant="secondary"
                        size="sm"
                        href={`/admin/sites/${bundle.siteModel.slug}?view=site&versionId=${encodeURIComponent(editingVersion.id)}`}
                      >
                        Preview
                      </AdminButtonLink>
                      <AdminButtonLink variant="secondary" size="sm" href={`/admin/sites/${bundle.siteModel.slug}?view=runs`}>
                        Runs
                      </AdminButtonLink>
                    </AdminButtonRow>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sites.length === 0 ? <p className="muted">No managed sites yet.</p> : null}
      </section>
    </main>
  );
}

function latestVersionCreatedAt(versions: { createdAt: string }[]) {
  return versions.reduce((latest, version) => (version.createdAt > latest ? version.createdAt : latest), versions[0]?.createdAt ?? new Date(0).toISOString());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function sourceHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}
