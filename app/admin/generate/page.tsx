import type { Metadata } from "next";
import { AdminButtonLink, AdminButtonRow } from "@/components/admin/AdminButton";
import { AdminGenerateForm } from "@/components/admin/AdminGenerateForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

export default async function AdminGeneratePage() {
  await requireAdminPageAccess("/admin/generate");
  const [recentRuns, recentGenerations, queuedJobs, runningJobs] = await Promise.all([
    repository.listAgentRuns({ runType: "site_generation", limit: 8 }),
    repository.listSiteGenerations({ limit: 8 }),
    repository.listJobs("queued"),
    repository.listJobs("running")
  ]);
  const activeGenerationJobs = [...runningJobs, ...queuedJobs].filter((job) => job.kind === "generate_site").slice(0, 8);

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Generation"
        title="Generate"
        description="Create internal site generations from public website URLs, then promote the right candidate to a managed site."
      />

      <div className="admin-grid">
        <section className="panel">
          <h2>New Site Generation</h2>
          <AdminGenerateForm />
        </section>

        <section className="panel">
          <h2>Pending Generation Jobs</h2>
          <div className="finding-list">
            {activeGenerationJobs.map((job) => (
              <article key={job.id} className="finding-card compact-card">
                <span className={`badge status-${job.status}`}>{job.status}</span>
                <h3>{stringPayload(job.payload, "url") ?? stringPayload(job.payload, "prompt") ?? job.id}</h3>
                <p className="muted">
                  Attempts {job.attempts}/{job.maxAttempts} / queued {formatDuration(job.createdAt)}
                </p>
                <small>{job.id}</small>
              </article>
            ))}
            {activeGenerationJobs.length === 0 ? <p className="muted">No generation jobs are queued or running.</p> : null}
          </div>
        </section>

        <section className="panel">
          <h2>Telemetry</h2>
          <div className="finding-list">
            {recentRuns.runs.map((run) => (
              <article key={run.id} className="finding-card compact-card">
                <span className={`badge status-${run.status}`}>{run.status}</span>
                <h3>{run.outputSummary ?? run.inputSummary ?? run.sourceHost ?? run.id}</h3>
                <p className="muted">{run.sourceHost ?? run.source} / {formatDuration(run.startedAt, run.endedAt)}</p>
                <AdminButtonRow>
                  <AdminButtonLink variant="secondary" size="sm" href={`/admin/runs/${run.id}`}>
                    Inspect
                  </AdminButtonLink>
                  {run.targetType === "site_generation" && run.targetId ? (
                    <AdminButtonLink variant="secondary" size="sm" href={`/admin/site-generations/${run.targetId}`}>
                      Generation
                    </AdminButtonLink>
                  ) : null}
                </AdminButtonRow>
              </article>
            ))}
            {recentRuns.runs.length === 0 ? <p className="muted">No telemetry yet.</p> : null}
          </div>
        </section>
      </div>

      <section className="panel admin-section">
        <div className="section-heading-row">
          <h2>Recent site generations</h2>
          <AdminButtonLink variant="secondary" size="sm" href="/admin/site-generations">
            View all
          </AdminButtonLink>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Generation</th>
              <th>Vertical</th>
              <th>Status</th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {recentGenerations.generations.map((generation) => (
              <tr key={generation.id}>
                <td>
                  {generation.businessName}
                  <small>{generation.id}</small>
                </td>
                <td>{generation.vertical.replace(/_/g, " ")}</td>
                <td>
                  <span className={`badge status-${generation.status}`}>{generation.status}</span>
                  <small>{generation.candidateSlug}</small>
                </td>
                <td>
                  <AdminButtonRow>
                    <AdminButtonLink variant="secondary" size="sm" href={`/admin/site-generations/${generation.id}`}>
                      Review
                    </AdminButtonLink>
                    {generation.createdSiteId ? (
                      <AdminButtonLink variant="secondary" size="sm" href="/admin/sites">
                        Managed sites
                      </AdminButtonLink>
                    ) : null}
                  </AdminButtonRow>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {recentGenerations.generations.length === 0 ? <p className="muted">No site generations yet.</p> : null}
      </section>
    </main>
  );
}

function formatDuration(startedAt: string, endedAt?: string) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "duration unknown";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return `${seconds}s`;
}

function stringPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}
