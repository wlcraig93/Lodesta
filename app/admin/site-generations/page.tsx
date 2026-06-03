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

export default async function AdminSiteGenerationsPage() {
  await requireAdminPageAccess("/admin/site-generations");
  const result = await repository.listSiteGenerations({ limit: 100 });

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Review queue"
        title="Site generations"
        description="Review generated candidates before promoting one into the managed site inventory."
        actions={
          <AdminButtonLink variant="primary" href="/admin/generate">
            New generation
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {result.generations.map((generation) => (
              <tr key={generation.id}>
                <td>
                  {generation.businessName}
                  <small>{generation.id}</small>
                  <span className="badge sites-detected-type">
                    Detected type: {generation.vertical.replace(/_/g, " ")}
                  </span>
                </td>
                <td>
                  {generation.sourceUrl ? (
                    <a href={generation.sourceUrl}>{generation.sourceHost ?? sourceHost(generation.sourceUrl)}</a>
                  ) : (
                    <span className="muted">Prompt only</span>
                  )}
                  <small>{generation.candidateSlug}</small>
                </td>
                <td>
                  <span className={`badge status-${generation.status}`}>{generation.status}</span>
                  {generation.createdSiteId ? <small>{generation.createdSiteId}</small> : null}
                </td>
                <td>{formatDate(generation.createdAt)}</td>
                <td>
                  <AdminButtonRow>
                    <AdminButtonLink variant="primary" size="sm" href={`/admin/site-generations/${generation.id}`}>
                      Review
                    </AdminButtonLink>
                    <AdminButtonAnchor
                      variant="secondary"
                      size="sm"
                      href={`/site-generation-previews/${generation.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Preview
                    </AdminButtonAnchor>
                    {generation.agentRunId ? (
                      <AdminButtonLink variant="secondary" size="sm" href={`/admin/runs/${generation.agentRunId}`}>
                        Telemetry
                      </AdminButtonLink>
                    ) : null}
                  </AdminButtonRow>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.generations.length === 0 ? <p className="muted">No site generations yet.</p> : null}
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
