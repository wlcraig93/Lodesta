import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminButtonLink, AdminButtonRow } from "@/components/admin/AdminButton";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ModelBakeoffRefresh } from "@/components/admin/ModelBakeoffRefresh";
import { ProductStatusBadge } from "@/components/ProductUI";
import { humanize, statusTone } from "@/lib/product-format";
import { requireAdminPageAccess } from "@/lib/page-access";
import { getModelBakeoffView, type ModelBakeoffRunView } from "@/packages/model-bakeoff";
import styles from "../model-bakeoffs.module.css";

export const dynamic = "force-dynamic";

export default async function ModelBakeoffDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ experimentId: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const [{ experimentId }, query] = await Promise.all([params, searchParams]);
  await requireAdminPageAccess(`/model-bakeoffs/${experimentId}`);
  const view = await getModelBakeoffView(experimentId);
  if (!view) notFound();
  const selectedSource = view.experiment.sources.find((source) => source.key === query.source)
    ?? view.experiment.sources[0];
  const candidates = view.rows.filter((row) => row.item.source.key === selectedSource.key);
  const active = ["queued", "running"].includes(view.experiment.status);
  const totalRuns = view.experiment.sources.length * view.experiment.candidates.length;

  return (
    <main className={`admin-page ${styles.detailPage}`}>
      <AdminPageHeader
        eyebrow={<ProductStatusBadge tone={statusTone(view.experiment.status)}>{humanize(view.experiment.status)}</ProductStatusBadge>}
        title={view.experiment.name}
        description={view.experiment.purpose}
        actions={
          <AdminButtonRow>
            <AdminButtonLink href="/model-bakeoffs">All bake-offs</AdminButtonLink>
            <ModelBakeoffRefresh active={active} />
          </AdminButtonRow>
        }
      />

      <section className={styles.metricStrip} aria-label="Experiment metrics">
        <Metric label="Complete" value={`${view.totals.completed}/${totalRuns}`} />
        <Metric label="Failed" value={String(view.totals.failed)} />
        <Metric label="Build cost" value={money(view.totals.totalCostUsd)} />
        <Metric label="Assessment cost" value={money(view.totals.assessmentCostUsd)} />
        <Metric label="Median score" value={view.totals.medianQualityScore?.toFixed(0) ?? "—"} />
        <Metric label="Median duration" value={duration(view.totals.medianDurationMs)} />
      </section>

      <section className={styles.sourceRail} aria-label="Source website">
        <div>
          <span>Source profile</span>
          <strong>{selectedSource.label}</strong>
          <p>{selectedSource.profile}</p>
        </div>
        <nav aria-label="Choose source">
          {view.experiment.sources.map((source, index) => (
            <Link
              className={source.key === selectedSource.key ? styles.sourceActive : undefined}
              aria-current={source.key === selectedSource.key ? "page" : undefined}
              href={`/model-bakeoffs/${encodeURIComponent(experimentId)}?source=${encodeURIComponent(source.key)}`}
              key={source.key}
            >
              <span>0{index + 1}</span>{source.label}
            </Link>
          ))}
        </nav>
        <a href={selectedSource.url} target="_blank" rel="noreferrer">Open source ↗</a>
      </section>

      <section className={styles.previewGrid} aria-label={`Candidate previews for ${selectedSource.label}`}>
        {candidates.map((row) => <CandidateCard row={row} key={row.item.id} />)}
      </section>

      <section className={styles.matrixSection}>
        <div className={styles.sectionHeading}>
          <div>
            <span>All {totalRuns} runs</span>
            <h2>Experiment matrix</h2>
          </div>
          <p>Quality scores are automated decision support. Final visual and code review remains human.</p>
        </div>
        <div className={styles.matrixScroller}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Authoring route</th>
                <th scope="col">State</th>
                <th scope="col">Served by</th>
                <th scope="col">Requests</th>
                <th scope="col">Cost</th>
                <th scope="col">Duration</th>
                <th scope="col">Score</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => {
                const usage = row.agentRun?.usage.kind === "model_reported" ? row.agentRun.usage : undefined;
                return (
                  <tr key={row.item.id}>
                    <td><strong>{row.item.source.label}</strong><small>{host(row.item.source.url)}</small></td>
                    <td><strong>{row.item.candidate.label}</strong><small>{row.item.candidate.apiProvider}:{row.item.candidate.modelId}</small></td>
                    <td><ProductStatusBadge tone={statusTone(row.item.status)}>{humanize(row.item.status)}</ProductStatusBadge></td>
                    <td>{row.servedModelIds.join(", ") || "—"}<small>{row.upstreamProviders.join(", ") || "No response yet"}</small></td>
                    <td>{row.requestCount || "—"}</td>
                    <td>{usage ? money(usage.costUsd) : "—"}</td>
                    <td>{duration(usage?.durationMs)}</td>
                    <td>{row.assessment?.assessment?.score?.value.toFixed(0) ?? "—"}</td>
                    <td>
                      {row.item.runId ? <Link href={`/admin/runs/${row.item.runId}`}>Run</Link> : "—"}
                      {row.item.candidateVersionId ? <> · <a href={previewUrl(row.item.candidateVersionId)} target="_blank">Preview</a></> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function CandidateCard({ row }: { row: ModelBakeoffRunView }) {
  const usage = row.agentRun?.usage.kind === "model_reported" ? row.agentRun.usage : undefined;
  const score = row.assessment?.assessment?.score;
  const versionId = row.item.candidateVersionId;
  return (
    <article className={styles.candidateCard} data-candidate={row.item.candidate.key}>
      <header>
        <div>
          <span>{row.item.candidate.apiProvider}</span>
          <h2>{row.item.candidate.label}</h2>
          <code>{row.item.candidate.modelId}</code>
        </div>
        <ProductStatusBadge tone={statusTone(row.item.status)}>{humanize(row.item.status)}</ProductStatusBadge>
      </header>
      <div className={styles.previewFrame}>
        {versionId ? (
          <iframe
            src={previewUrl(versionId)}
            title={`${row.item.candidate.label} preview for ${row.item.source.label}`}
            loading="lazy"
          />
        ) : (
          <div className={styles.previewEmpty}>
            <span>{row.item.status === "failed" ? "Run failed" : "Preview pending"}</span>
            <p>{row.item.failureReason ?? "The verified candidate will appear here when authoring completes."}</p>
          </div>
        )}
      </div>
      <dl className={styles.candidateMetrics}>
        <div><dt>Quality</dt><dd>{score ? `${score.value.toFixed(0)} · ${humanize(score.verdict)}` : "—"}</dd></div>
        <div><dt>Build cost</dt><dd>{usage ? money(usage.costUsd) : "—"}</dd></div>
        <div><dt>Duration</dt><dd>{duration(usage?.durationMs)}</dd></div>
        <div><dt>Requests</dt><dd>{row.requestCount || "—"}</dd></div>
      </dl>
      <footer>
        <div>
          <span>Served model</span>
          <strong>{row.servedModelIds.join(", ") || "Awaiting response"}</strong>
          <small>{row.upstreamProviders.join(", ") || "Upstream not reported"}</small>
        </div>
        <div className={styles.cardLinks}>
          {row.item.runId ? <Link href={`/admin/runs/${row.item.runId}`}>Inspect run</Link> : null}
          {versionId ? <a href={previewUrl(versionId)} target="_blank">Full preview ↗</a> : null}
        </div>
      </footer>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function previewUrl(versionId: string) {
  return `/api/site-versions/${encodeURIComponent(versionId)}/artifact`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function duration(value?: number) {
  if (value === undefined) return "—";
  const minutes = value / 60_000;
  return minutes < 1 ? `${Math.round(value / 1_000)}s` : `${minutes.toFixed(minutes >= 10 ? 0 : 1)}m`;
}

function host(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return value; }
}
