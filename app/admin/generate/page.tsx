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
  const [recentRuns, recentCandidates, queuedJobs, runningJobs] = await Promise.all([
    repository.listAgentRuns({ runType: "site_generation", limit: 8 }),
    repository.listSiteCandidates({ limit: 8 }),
    repository.listJobs("queued"),
    repository.listJobs("running")
  ]);
  const activeGenerationJobs = [...runningJobs, ...queuedJobs].filter((job) => job.kind === "generate_site").slice(0, 8);

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Generation Lab"
        title="Create and review candidates"
        description="Generate experimental site candidates from source URLs, inspect the output, and accept only the ones worth managing."
      />

      <div className="admin-grid">
        <section className="panel">
          <h2>New candidate</h2>
          <AdminGenerateForm />
        </section>

        <section className="panel">
          <h2>Pending jobs</h2>
          <div className="finding-list">
            {activeGenerationJobs.map((job) => (
              <article key={job.id} className="finding-card compact-card">
                <span className={`badge status-${job.status}`}>{job.status}</span>
                <h3>{stringPayload(job.payload, "url") ?? stringPayload(job.payload, "prompt") ?? job.id}</h3>
                <p className="muted">
                  Attempts {job.attempts}/{job.maxAttempts} / queued {formatDate(job.createdAt)} ({formatDuration(job.createdAt)} ago)
                </p>
                <small>{job.id}</small>
              </article>
            ))}
            {activeGenerationJobs.length === 0 ? <p className="muted">No generation jobs are queued or running.</p> : null}
          </div>
        </section>

        <section className="panel">
          <h2>Recent activity</h2>
          <div className="finding-list">
            {recentRuns.runs.map((run) => (
              <article key={run.id} className="finding-card compact-card">
                <span className={`badge status-${run.status}`}>{run.status}</span>
                <h3>{run.outputSummary ?? run.inputSummary ?? run.sourceHost ?? run.id}</h3>
                <p className="muted">
                  {run.sourceHost ?? run.source} / started {formatDate(run.startedAt)} / {formatDuration(run.startedAt, run.endedAt)}
                </p>
                <AdminButtonRow>
                  <AdminButtonLink variant="secondary" size="sm" href={`/admin/runs/${run.id}`}>
                    Inspect
                  </AdminButtonLink>
                  {run.targetType === "site_candidate" && run.targetId ? (
                    <AdminButtonLink variant="secondary" size="sm" href={`/admin/site-candidates/${run.targetId}`}>
                      Candidate
                    </AdminButtonLink>
                  ) : null}
                </AdminButtonRow>
              </article>
            ))}
            {recentRuns.runs.length === 0 ? <p className="muted">No generation activity yet.</p> : null}
          </div>
        </section>
      </div>

      <section className="panel admin-section">
        <div className="section-heading-row">
          <h2>Recent candidates</h2>
          <AdminButtonLink variant="secondary" size="sm" href="/admin/site-candidates">
            View all
          </AdminButtonLink>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Vertical</th>
              <th>Status</th>
              <th>Created</th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {recentCandidates.candidates.map((candidate) => (
              <tr key={candidate.id}>
                <td>
                  {candidate.businessName}
                  <small>{candidate.id}</small>
                </td>
                <td>{candidate.vertical.replace(/_/g, " ")}</td>
                <td>
                  <span className={`badge status-${candidate.status}`}>{candidate.status}</span>
                  <small>{candidate.candidateSlug}</small>
                </td>
                <td>{formatDate(candidate.createdAt)}</td>
                <td>
                  <AdminButtonRow>
                    <AdminButtonLink variant="secondary" size="sm" href={`/admin/site-candidates/${candidate.id}`}>
                      Review
                    </AdminButtonLink>
                    {candidate.acceptedSiteId ? (
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
        {recentCandidates.candidates.length === 0 ? <p className="muted">No candidates yet.</p> : null}
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

function formatDate(input: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(input));
}

function stringPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}
