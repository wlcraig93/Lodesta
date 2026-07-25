"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";
import { adminRunPageSizes, adminRunSorts, adminRunStatuses } from "@/lib/admin-run-query";
import type {
  SiteAgentRunAdminListItem,
  SiteAgentRunAdminQuery,
  SiteAgentRunAdminSort
} from "@/packages/platform-data";
import type { SiteAgentRun } from "@/packages/site-contracts";
import { humanize, statusTone } from "@/lib/product-format";
import { ProductSelect } from "@/components/ProductUI";

type InventoryFilters = {
  search: string;
  statuses: SiteAgentRun["status"][];
  siteId: string;
  range: "" | "24h" | "7d" | "30d";
  from: string;
  to: string;
  sort: SiteAgentRunAdminSort;
  limit: 25 | 50 | 100;
  offset: number;
};

type InventoryResponse = {
  items: SiteAgentRunAdminListItem[];
  total: number;
  limit: number;
  offset: number;
};

export function AdminRunInventory({
  initialItems,
  initialTotal,
  initialQuery,
  sites
}: {
  initialItems: SiteAgentRunAdminListItem[];
  initialTotal: number;
  initialQuery: SiteAgentRunAdminQuery;
  sites: Array<{ id: string; slug: string }>;
}) {
  const router = useRouter();
  const initial = useMemo(() => filtersFromQuery(initialQuery), [initialQuery]);
  const [filters, setFilters] = useState(initial);
  const [searchInput, setSearchInput] = useState(initial.search);
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const skipInitialFetch = useRef(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => current.search === searchInput ? current : { ...current, search: searchInput, offset: 0 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const params = queryParams(filters);
    router.replace(`/admin/runs?${params.toString()}`, { scroll: false });
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    fetch(`/api/admin/runs?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
          throw new Error(payload?.error ?? `Run inventory request failed (${response.status}).`);
        }
        return response.json() as Promise<InventoryResponse>;
      })
      .then((payload) => {
        setItems(payload.items);
        setTotal(payload.total);
      })
      .catch((cause: unknown) => {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Run inventory request failed.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, router]);

  const start = total ? filters.offset + 1 : 0;
  const end = Math.min(filters.offset + filters.limit, total);
  const page = Math.floor(filters.offset / filters.limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / filters.limit));
  const activeFilterCount = filters.statuses.length
    + (filters.siteId ? 1 : 0)
    + (filters.range || filters.from || filters.to ? 1 : 0);

  function update(patch: Partial<InventoryFilters>, resetPage = true) {
    setFilters((current) => ({ ...current, ...patch, offset: resetPage ? 0 : patch.offset ?? current.offset }));
  }

  function setCustomDate(key: "from" | "to", value: string) {
    update({ range: "", [key]: value });
  }

  function clearFilters() {
    setSearchInput("");
    setFilters({ search: "", statuses: [], siteId: "", range: "", from: "", to: "", sort: "newest", limit: 50, offset: 0 });
  }

  return <section className="admin-run-inventory" aria-busy={loading}>
    <header className="admin-run-inventory-heading">
      <div>
        <h2>Recent runs</h2>
        <p>{total ? `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}` : activeFilterCount || filters.search ? "No runs match these filters" : "No runs captured yet"}</p>
      </div>
      <label className="admin-run-search">
        <span className="sr-only">Search runs</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Run, site, model, provider, or failure code"
        />
      </label>
    </header>

    <div className="admin-run-toolbar">
      <details className="admin-run-filter-menu">
        <summary>Status<span>{filters.statuses.length ? `${filters.statuses.length} selected` : "All"}</span></summary>
        <fieldset>
          <legend>Filter by status</legend>
          {adminRunStatuses.map((status) => <label key={status}>
            <input
              type="checkbox"
              checked={filters.statuses.includes(status)}
              onChange={() => update({
                statuses: filters.statuses.includes(status)
                  ? filters.statuses.filter((value) => value !== status)
                  : [...filters.statuses, status]
              })}
            />
            <span>{humanize(status)}</span>
          </label>)}
        </fieldset>
      </details>

      <label className="admin-run-control">
        <span>Site</span>
        <ProductSelect value={filters.siteId} onChange={(event) => update({ siteId: event.target.value })}>
          <option value="">All sites</option>
          {sites.map((site) => <option value={site.id} key={site.id}>{site.slug}</option>)}
        </ProductSelect>
      </label>

      <div className="admin-run-range-presets" role="group" aria-label="Run date range">
        {(["24h", "7d", "30d"] as const).map((range) => <button
          type="button"
          key={range}
          aria-pressed={filters.range === range}
          onClick={() => update({ range: filters.range === range ? "" : range, from: "", to: "" })}
        >{range}</button>)}
      </div>

      <label className="admin-run-control admin-run-date">
        <span>From</span>
        <input type="date" value={filters.from} onChange={(event) => setCustomDate("from", event.target.value)} />
      </label>
      <label className="admin-run-control admin-run-date">
        <span>To</span>
        <input type="date" value={filters.to} onChange={(event) => setCustomDate("to", event.target.value)} />
      </label>

      <label className="admin-run-control">
        <span>Sort</span>
        <ProductSelect value={filters.sort} onChange={(event) => update({ sort: event.target.value as SiteAgentRunAdminSort })}>
          {adminRunSorts.map((sort) => <option value={sort} key={sort}>{sortLabel(sort)}</option>)}
        </ProductSelect>
      </label>

      <AdminButton type="button" variant="ghost" size="sm" onClick={clearFilters} disabled={!activeFilterCount && !filters.search && filters.sort === "newest" && filters.limit === 50}>
        Clear
      </AdminButton>
    </div>

    {error ? <div className="admin-run-inventory-notice" role="alert"><span>{error}</span><AdminButton type="button" size="sm" onClick={() => setFilters((current) => ({ ...current }))}>Retry</AdminButton></div> : null}
    {loading ? <div className="admin-run-loading" role="status">Updating runs…</div> : null}

    <div className="admin-run-list">
      <div className="admin-run-list-header" aria-hidden="true">
        <span>Status</span><span>Run / site</span><span>Model</span><span>Tokens</span><span>Cost</span><span>Duration</span><span>Started</span>
      </div>
      <div className="admin-run-list-body">
        {items.map((item) => <Link className="admin-run-row" href={`/admin/runs/${item.id}`} key={item.id}>
          <span className="admin-run-cell admin-run-status-cell" data-label="Status">
            <span className={`badge is-${statusTone(item.status)}`}>{humanize(item.status)}</span>
            <small>{humanize(item.stage)}</small>
          </span>
          <span className="admin-run-cell admin-run-identity-cell" data-label="Run / site">
            <strong>{humanize(item.kind)}</strong>
            <code>{item.id}</code>
            <small>{item.siteSlug ?? item.siteId}</small>
            {item.failureCode ? <small className="error-text">{humanize(item.failureCode)}</small> : null}
            {item.failurePreview ? <small className="admin-run-failure-preview" title={item.failurePreview}>{item.failurePreview}</small> : null}
            {item.issue ? <small className="error-text">{item.issue}</small> : null}
          </span>
          <span className="admin-run-cell" data-label="Model">
            <strong>{item.modelId ?? "Unverified"}</strong>
            <small>{item.apiProvider ?? humanize(item.executionDriver)}</small>
          </span>
          <span className="admin-run-cell admin-run-numeric" data-label="Tokens">{item.tokenCount?.toLocaleString() ?? "—"}</span>
          <span className="admin-run-cell admin-run-numeric" data-label="Cost">{formatCost(item.costUsd, item.costSource)}</span>
          <span className="admin-run-cell admin-run-numeric" data-label="Duration">{formatDuration(item.durationMs)}</span>
          <span className="admin-run-cell" data-label="Started"><time dateTime={item.startedAt}>{formatDate(item.startedAt)}</time></span>
        </Link>)}
        {!items.length ? <div className="admin-run-empty"><strong>{activeFilterCount || filters.search ? "No runs found" : "No runs captured yet"}</strong><p>{activeFilterCount || filters.search ? "Clear a filter or broaden the search." : "Runs will appear here when site authoring begins."}</p></div> : null}
      </div>
    </div>

    <footer className="admin-run-pagination">
      <label>Rows
        <ProductSelect value={filters.limit} onChange={(event) => update({ limit: Number(event.target.value) as 25 | 50 | 100 })}>
          {adminRunPageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
        </ProductSelect>
      </label>
      <span>Page {page.toLocaleString()} of {pageCount.toLocaleString()}</span>
      <div>
        <AdminButton type="button" size="sm" disabled={page <= 1 || loading} onClick={() => update({ offset: Math.max(0, filters.offset - filters.limit) }, false)}>Previous</AdminButton>
        <AdminButton type="button" size="sm" disabled={page >= pageCount || loading} onClick={() => update({ offset: filters.offset + filters.limit }, false)}>Next</AdminButton>
      </div>
    </footer>
  </section>;
}

function filtersFromQuery(query: SiteAgentRunAdminQuery): InventoryFilters {
  return {
    search: query.search ?? "",
    statuses: query.statuses ?? [],
    siteId: query.siteId ?? "",
    range: query.range ?? "",
    from: query.range ? "" : query.startedAfter?.slice(0, 10) ?? "",
    to: query.range ? "" : query.startedBefore?.slice(0, 10) ?? "",
    sort: query.sort ?? "newest",
    limit: (query.limit ?? 50) as 25 | 50 | 100,
    offset: query.offset ?? 0
  };
}

function queryParams(filters: InventoryFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("q", filters.search.trim());
  if (filters.statuses.length) params.set("status", filters.statuses.join(","));
  if (filters.siteId) params.set("siteId", filters.siteId);
  if (filters.range) {
    params.set("range", filters.range);
  } else {
    if (filters.from) params.set("from", startOfLocalDay(filters.from));
    if (filters.to) params.set("to", endOfLocalDay(filters.to));
  }
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  if (filters.limit !== 50) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  return params;
}

function startOfLocalDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function endOfLocalDay(value: string) {
  return new Date(`${value}T23:59:59.999Z`).toISOString();
}


function sortLabel(value: SiteAgentRunAdminSort) {
  return ({
    newest: "Newest",
    oldest: "Oldest",
    highest_cost: "Highest cost",
    lowest_cost: "Lowest cost",
    longest_duration: "Longest duration"
  } as const)[value];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatDuration(value: number) {
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round(value % 60_000 / 1000)}s`;
}

function formatCost(value: number | undefined, source: SiteAgentRunAdminListItem["costSource"]) {
  if (value === undefined || source === "unavailable") return "—";
  return `$${value.toFixed(4)}`;
}
