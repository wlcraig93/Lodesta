import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ExternalAuthoringBatchCreateForm } from "@/components/admin/ExternalAuthoringBatchCreateForm";
import { requireAdminPageAccess } from "@/lib/page-access";
import {
  deriveBatchStatus,
  getExternalAuthoringBatchView
} from "@/packages/external-authoring/service";
import { externalAuthoringRepository } from "@/packages/external-authoring/repository";
import { humanize } from "@/lib/product-format";

export const dynamic = "force-dynamic";

export default async function AuthoringBatchesPage() {
  await requireAdminPageAccess("/authoring-batches");
  const batches = await externalAuthoringRepository.listBatches();
  const views = await Promise.all(batches.map((batch) => getExternalAuthoringBatchView(batch.id)));

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Operator-only"
        title="External Codex authoring"
        description="Prepare prospect websites in Lodesta, author them through your personal Codex session, and return verified candidates to Lodesta without using Lodesta model API tokens."
      />

      <section className="external-authoring-boundary" aria-label="Safety boundary">
        <strong>Human authorization happens here.</strong>
        <p>These batches can prepare drafts and private previews. They cannot publish, transfer ownership, delete sites, or send outreach.</p>
      </section>

      <div className="external-authoring-layout">
        <section className="panel">
          <h2>New batch</h2>
          <ExternalAuthoringBatchCreateForm />
        </section>
        <section className="panel">
          <div className="section-heading-row">
            <div>
              <h2>Recent batches</h2>
              <p className="muted">{batches.length} total</p>
            </div>
          </div>
          <div className="external-batch-list">
            {views.map((view, index) => {
              const batch = batches[index];
              const statuses = view?.rows.map((row) => row.status) ?? [];
              const status = view?.status ?? deriveBatchStatus(statuses, Boolean(batch.cancelRequestedAt));
              const ready = statuses.filter((item) => item === "candidate_ready").length;
              return (
                <Link key={batch.id} href={`/authoring-batches/${encodeURIComponent(batch.id)}`} className="external-batch-row">
                  <div>
                    <strong>{batch.name}</strong>
                    <small>{formatDate(batch.createdAt)} · {statuses.length} websites</small>
                  </div>
                  <div>
                    <span className={`external-status external-status-${status}`}>{humanize(status)}</span>
                    <small>{ready}/{statuses.length} candidates</small>
                  </div>
                </Link>
              );
            })}
            {!batches.length ? <p className="muted">No external authoring batches yet.</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
