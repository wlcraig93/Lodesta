import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import {
  defaultProspectCandidateFilters,
  defaultProspectExplorerColumns,
  parseProspectCandidateQuery,
  prospectCandidateQuerySchema,
  prospectExplorerFieldKeys,
  type ProspectExplorerFieldKey
} from "@/packages/prospect-research";
import { ProspectExplorer } from "./ProspectExplorer";
import styles from "./prospects.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type RawSearchParams = Record<string, string | string[] | undefined>;

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireAdminPageAccess("/prospects");
  const raw = await searchParams;
  const parsed = parseProspectCandidateQuery(toSearchParams(raw), { defaultToPending: true });
  const initialNotice = parsed.success ? undefined : "Some URL filters were invalid, so the pending view was restored.";
  const requestedQuery = parsed.success
    ? parsed.data
    : prospectCandidateQuerySchema.parse({ filters: defaultProspectCandidateFilters() });
  const total = await repository.countProspectCandidates(requestedQuery);
  const pageCount = Math.max(1, Math.ceil(total / requestedQuery.limit));
  const requestedPage = Math.floor(requestedQuery.offset / requestedQuery.limit) + 1;
  const offset = (Math.min(requestedPage, pageCount) - 1) * requestedQuery.limit;
  const initialQuery = { ...requestedQuery, offset };
  const prospects = await repository.listProspectCandidates(initialQuery);

  return (
    <main className={`admin-page ${styles.page}`}>
      <AdminPageHeader
        eyebrow="Market research"
        title="Prospect explorer"
        description="Build a view from any prospect field, choose the columns that matter, and inspect the evidence behind each record."
      />
      <ProspectExplorer
        initialProspects={prospects}
        initialTotal={total}
        initialQuery={initialQuery}
        initialColumns={columnsFromRaw(raw.columns)}
        initialNotice={initialNotice}
      />
    </main>
  );
}

function toSearchParams(raw: RawSearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  return params;
}

function columnsFromRaw(value: string | string[] | undefined): ProspectExplorerFieldKey[] {
  const raw = Array.isArray(value) ? value[0] : value;
  const available = new Set<ProspectExplorerFieldKey>(prospectExplorerFieldKeys);
  const selected = (raw?.split(",") ?? []).filter((key): key is ProspectExplorerFieldKey => available.has(key as ProspectExplorerFieldKey));
  if (!selected.length) return [...defaultProspectExplorerColumns];
  return ["business_name", ...selected.filter((key) => key !== "business_name")];
}
