import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ProductStatusBadge } from "@/components/ProductUI";
import { formatProductDate, humanize, statusTone } from "@/lib/product-format";
import { requireAdminPageAccess } from "@/lib/page-access";
import { getModelBakeoffView, modelBakeoffRepository } from "@/packages/model-bakeoff";
import styles from "./model-bakeoffs.module.css";

export const dynamic = "force-dynamic";

export default async function ModelBakeoffsPage() {
  await requireAdminPageAccess("/model-bakeoffs");
  const experiments = await modelBakeoffRepository.listExperiments();
  const views = await Promise.all(experiments.map((experiment) => getModelBakeoffView(experiment.id)));

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Evaluation lab"
        title="Model bake-offs"
        description="Private, apples-to-apples authoring comparisons. Every candidate uses the same intake, tools, guardrails, and verification boundary; nothing here is published."
      />

      <section className={styles.boundary} aria-label="Experiment boundary">
        <span>Private candidates</span>
        <p>Source facts remain canonical. Model identity, served route, upstream provider, cost, duration, assessment, and artifact provenance stay attached to every run.</p>
      </section>

      <section className={styles.experimentList} aria-label="Bake-off experiments">
        {views.map((view, index) => {
          if (!view) return null;
          const experiment = experiments[index];
          return (
            <Link className={styles.experimentRow} href={`/model-bakeoffs/${encodeURIComponent(experiment.id)}`} key={experiment.id}>
              <div className={styles.experimentLead}>
                <ProductStatusBadge tone={statusTone(experiment.status)}>{humanize(experiment.status)}</ProductStatusBadge>
                <div>
                  <strong>{experiment.name}</strong>
                  <small>{experiment.sources.length} sources × {experiment.candidates.length} routes · created {formatProductDate(experiment.createdAt, false)}</small>
                </div>
              </div>
              <dl className={styles.experimentMetrics}>
                <div><dt>Complete</dt><dd>{view.totals.completed}/{experiment.sources.length * experiment.candidates.length}</dd></div>
                <div><dt>Build cost</dt><dd>{money(view.totals.totalCostUsd)}</dd></div>
                <div><dt>Median score</dt><dd>{view.totals.medianQualityScore?.toFixed(0) ?? "—"}</dd></div>
              </dl>
              <span className={styles.rowArrow} aria-hidden="true">→</span>
            </Link>
          );
        })}
        {!experiments.length ? (
          <div className={styles.empty}>
            <strong>No experiments yet</strong>
            <p>Run <code>npm run run:model-bakeoff</code> to create and execute a private comparison.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
