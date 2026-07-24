import { notFound } from "next/navigation";
import { AdminButtonLink, AdminButtonRow } from "@/components/admin/AdminButton";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  ExternalBatchCancelButton,
  ExternalBatchRefreshButton,
  ExternalClarificationForm,
  ExternalPreviewButton,
  ExternalRetryButton
} from "@/components/admin/ExternalAuthoringBatchActions";
import { requireAdminPageAccess } from "@/lib/page-access";
import { getExternalAuthoringBatchView } from "@/packages/external-authoring/service";

export const dynamic = "force-dynamic";

export default async function AuthoringBatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  await requireAdminPageAccess(`/authoring-batches/${batchId}`);
  const view = await getExternalAuthoringBatchView(batchId);
  if (!view) notFound();
  const terminal = ["completed", "completed_with_errors", "cancelled"].includes(view.status);
  const counts = new Map<string, number>();
  for (const row of view.rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow={<span className={`external-status external-status-${view.status}`}>{humanize(view.status)}</span>}
        title={view.batch.name}
        description={`${view.rows.length} website${view.rows.length === 1 ? "" : "s"} in this batch. Work is claimed from the dedicated Codex profile; transport reconnects preserve the logical claim.`}
        actions={
          <AdminButtonRow>
            <AdminButtonLink href="/authoring-batches">All batches</AdminButtonLink>
            <ExternalBatchRefreshButton />
            <ExternalBatchCancelButton batchId={batchId} disabled={terminal || Boolean(view.batch.cancelRequestedAt)} />
          </AdminButtonRow>
        }
      />

      <section className="metric-row compact">
        <Metric label="Candidate ready" value={counts.get("candidate_ready") ?? 0} />
        <Metric label="Active" value={sum(counts, ["claimed", "authoring", "finalizing"])} />
        <Metric label="Needs input" value={counts.get("needs_input") ?? 0} />
      </section>

      <section className="panel external-authoring-table-panel">
        <table className="data-table external-authoring-table">
          <thead>
            <tr>
              <th scope="col">Website</th>
              <th scope="col">State</th>
              <th scope="col">Execution</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map(({ item, execution, run, status }) => (
              <tr key={item.id}>
                <td>
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer">{host(item.sourceUrl)}</a>
                  <small>{item.businessNameHint ? `Hint: ${item.businessNameHint}` : "No operator name hint"}</small>
                </td>
                <td><span className={`external-status external-status-${status}`}>{humanize(status)}</span></td>
                <td>
                  <span>{execution ? `r${execution.stateRevision}` : "Preparing"}</span>
                  <small>
                    {execution?.claimedAt ? `Claimed ${relative(execution.claimedAt)}` : run?.stage ? humanize(run.stage) : "Awaiting execution"}
                  </small>
                </td>
                <td>
                  {item.previewId ? <ExternalPreviewButton previewId={item.previewId} /> : <span className="muted">—</span>}
                  {status === "failed" && run?.retryableByOwner ? (
                    <ExternalRetryButton batchId={batchId} itemId={item.id} />
                  ) : null}
                  {status === "needs_input" && run?.inputQuestion ? (
                    <ExternalClarificationForm
                      batchId={batchId}
                      itemId={item.id}
                      question={run.inputQuestion}
                    />
                  ) : null}
                  {item.preparationFailureReason ? <small className="form-error">{item.preparationFailureReason}</small> : null}
                  {run?.failureReason ? <small className="form-error">{run.failureReason}</small> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="external-authoring-footnote">
        Model identity and token usage are intentionally unavailable to Lodesta. Lodesta records only operator-configured ChatGPT authentication expectations plus its own sandbox, browser, storage, and duration usage.
      </p>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <article className="metric-card"><strong>{value}</strong><span>{label}</span></article>;
}

function sum(counts: Map<string, number>, keys: string[]) {
  return keys.reduce((total, key) => total + (counts.get(key) ?? 0), 0);
}

function host(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return value; }
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function relative(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}
