import Link from "next/link";
import type { Metadata } from "next";
import { AdminButtonAnchor, AdminButtonLink, AdminButtonRow } from "@/components/admin/AdminButton";
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

export default async function AdminSiteCandidatesPage() {
  await requireAdminPageAccess("/admin/site-candidates");
  const result = await repository.listSiteCandidates({ limit: 100 });

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Generation Lab"
        title="Site Candidates"
        description="Review generated site candidates, compare evidence, and accept only the best outputs into durable sites."
        actions={
          <AdminButtonLink variant="primary" href="/admin/generate">
            New candidate
          </AdminButtonLink>
        }
      />

      <section className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Source</th>
              <th>Status</th>
              <th>Created</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {result.candidates.map((candidate) => (
              <tr key={candidate.id}>
                <td>
                  {candidate.businessName}
                  <small>{candidate.id}</small>
                  <span className="badge sites-detected-type">
                    Detected type: {candidate.vertical.replace(/_/g, " ")}
                  </span>
                </td>
                <td>
                  {candidate.sourceUrl ? (
                    <a href={candidate.sourceUrl}>{candidate.sourceHost ?? sourceHost(candidate.sourceUrl)}</a>
                  ) : (
                    <span className="muted">Prompt only</span>
                  )}
                  <small>{candidate.candidateSlug}</small>
                </td>
                <td>
                  <span className={`badge status-${candidate.status}`}>{candidate.status}</span>
                  {candidate.acceptedSiteId ? <small>{candidate.acceptedSiteId}</small> : null}
                </td>
                <td>{formatDate(candidate.createdAt)}</td>
                <td>{formatDate(candidate.updatedAt)}</td>
                <td>
                  <AdminButtonRow>
                    <AdminButtonLink variant="primary" size="sm" href={`/admin/site-candidates/${candidate.id}`}>
                      Review
                    </AdminButtonLink>
                    <AdminButtonAnchor
                      variant="secondary"
                      size="sm"
                      href={`/site-candidate-previews/${candidate.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Preview
                    </AdminButtonAnchor>
                    {candidate.agentRunId ? (
                      <AdminButtonLink variant="secondary" size="sm" href={`/admin/runs/${candidate.agentRunId}`}>
                        Activity
                      </AdminButtonLink>
                    ) : null}
                  </AdminButtonRow>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.candidates.length === 0 ? <p className="muted">No candidates yet.</p> : null}
      </section>
    </main>
  );
}

function formatDate(input: string) {
  return new Date(input).toLocaleString();
}

function sourceHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}
