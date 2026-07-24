import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminRunInventory } from "@/components/admin/AdminRunInventory";
import { parseAdminRunQuery } from "@/lib/admin-run-query";
import { requireAdminPageAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminRunsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPageAccess("/admin/runs");
  const params = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") urlParams.set(key, value);
  }
  const parsed = parseAdminRunQuery(urlParams);
  const query = parsed.success ? parsed.data : { sort: "newest" as const, limit: 50, offset: 0 };
  const [page, terminalPage, sites] = await Promise.all([
    sitePlatformRepository.listAgentRunAdminPage(query),
    sitePlatformRepository.listAgentRunAdminPage({ statuses: ["succeeded", "failed", "cancelled"], sort: "newest", limit: 25 }),
    sitePlatformRepository.listSites()
  ]);
  const terminalRuns = terminalPage.items.slice(0, 20);
  const costs = terminalRuns.flatMap((run) => run.costUsd === undefined ? [] : [run.costUsd]).sort((left, right) => left - right);

  return <main className="admin-page admin-run-inventory-page">
    <AdminPageHeader
      eyebrow="Debug"
      title="Agent activity"
      description="Search runs, compare usage, and inspect the complete authoring trace."
    />
    <section className="admin-run-summary-strip" aria-label={`Last ${terminalRuns.length} terminal runs`}>
      <SummaryMetric label={`Success · last ${terminalRuns.length}`} value={terminalRuns.length ? `${Math.round(terminalRuns.filter((run) => run.status === "succeeded").length / terminalRuns.length * 100)}%` : "—"} />
      <SummaryMetric label="Median cost" value={formatPercentile(costs, 0.5)} />
      <SummaryMetric label="P95 cost" value={formatPercentile(costs, 0.95)} />
      <SummaryMetric label="Failed" value={String(terminalRuns.filter((run) => run.status === "failed").length)} />
    </section>
    <AdminRunInventory
      initialItems={page.items}
      initialTotal={page.total}
      initialQuery={query}
      sites={sites.map((site) => ({ id: site.id, slug: site.slug }))}
    />
  </main>;
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function formatPercentile(values: number[], percentile: number) {
  if (!values.length) return "—";
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * percentile) - 1));
  return `$${values[index].toFixed(2)}`;
}
