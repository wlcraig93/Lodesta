"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { AdminButton } from "@/components/admin/AdminButton";
import { ProductDialog } from "@/components/ProductDialog";
import { ProductSelect } from "@/components/ProductUI";
import { formatProductDate, humanize } from "@/lib/product-format";
import type { ProspectCandidate, ProspectCandidateContact } from "@/packages/prospect-research/contracts";
import {
  defaultProspectExplorerColumns,
  defaultProspectFilterOperator,
  humanizeExplorerValue,
  prospectExplorerFieldList,
  prospectExplorerFields,
  prospectExplorerOperatorsFor,
  prospectExplorerValue,
  prospectExplorerViewForFilters,
  prospectExplorerViews,
  prospectFilterNeedsValue,
  prospectFilterOperatorLabel,
  type ProspectCandidateFilter,
  type ProspectCandidateQuery,
  type ProspectExplorerFieldCategory,
  type ProspectExplorerFieldKey,
  type ProspectExplorerView
} from "@/packages/prospect-research/explorer";
import { prospectCandidateQueryParams } from "@/packages/prospect-research/explorer-query";
import styles from "./prospects.module.css";

type ExplorerResponse = { prospects: ProspectCandidate[]; total: number; limit: number; offset: number };
type ColumnWidths = Partial<Record<ProspectExplorerFieldKey, number>>;

const categories: ProspectExplorerFieldCategory[] = ["Business", "Location", "Google", "Website", "Contacts", "System"];
const minimumColumnWidth = 104;
const maximumColumnWidth = 640;

export function ProspectExplorer({
  initialProspects,
  initialTotal,
  initialQuery,
  initialColumns,
  initialNotice
}: {
  initialProspects: ProspectCandidate[];
  initialTotal: number;
  initialQuery: ProspectCandidateQuery;
  initialColumns: ProspectExplorerFieldKey[];
  initialNotice?: string;
}) {
  const [query, setQuery] = useState<ProspectCandidateQuery>(initialQuery);
  const [search, setSearch] = useState(initialQuery.search ?? "");
  const [filters, setFilters] = useState<ProspectCandidateFilter[]>(initialQuery.filters ?? []);
  const [columns, setColumns] = useState<ProspectExplorerFieldKey[]>(initialColumns);
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => Object.fromEntries(initialColumns.map((key) => [key, defaultColumnWidth(key)])));
  const [filterBuilderOpen, setFilterBuilderOpen] = useState((initialQuery.filters?.length ?? 0) > 1);
  const [prospects, setProspects] = useState(initialProspects);
  const [total, setTotal] = useState(initialTotal);
  const [selected, setSelected] = useState<ProspectCandidate>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const skipInitialFetch = useRef(true);
  const resizeCleanup = useRef<() => void>(() => undefined);
  const requestKey = useMemo(() => prospectCandidateQueryParams(query).toString(), [query]);
  const appliedFilters = query.filters ?? [];
  const activeView = prospectExplorerViewForFilters(appliedFilters);
  const totalTableWidth = columns.reduce((sum, key) => sum + (columnWidths[key] ?? defaultColumnWidth(key)), 0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery((current) => ({ ...current, search: search.trim() || undefined, offset: 0 }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const readyFilters = filters.filter(filterIsReady);
      setQuery((current) => sameFilterList(current.filters ?? [], readyFilters)
        ? current
        : { ...current, filters: readyFilters, offset: 0 });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    if (skipInitialFetch.current) { skipInitialFetch.current = false; return; }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    fetch(`/api/admin/prospects?${requestKey}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Prospect request failed (${response.status}).`);
        return response.json() as Promise<ExplorerResponse>;
      })
      .then((payload) => { setProspects(payload.prospects); setTotal(payload.total); })
      .catch((cause: unknown) => {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Prospect request failed.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [requestKey]);

  useEffect(() => {
    const params = prospectCandidateQueryParams(query, activeView);
    if (!sameColumnList(columns, defaultProspectExplorerColumns)) params.set("columns", columns.join(","));
    const nextUrl = params.size ? `/prospects?${params.toString()}` : "/prospects";
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [activeView, columns, query]);

  useEffect(() => () => resizeCleanup.current(), []);

  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;
  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const firstResult = prospects.length ? offset + 1 : 0;
  const lastResult = prospects.length ? offset + prospects.length : 0;

  function applyView(view: Exclude<ProspectExplorerView, "custom">) {
    const nextFilters = prospectExplorerViews[view].filters.map((filter) => ({ ...filter }));
    setFilters(nextFilters);
    setQuery((current) => ({ ...current, filters: nextFilters, offset: 0 }));
  }

  function sortBy(key: ProspectExplorerFieldKey) {
    setQuery((current) => ({
      ...current,
      sortBy: key,
      sortDirection: current.sortBy === key && current.sortDirection === "asc" ? "desc" : "asc",
      offset: 0
    }));
  }

  function onHeaderKeyDown(event: KeyboardEvent<HTMLButtonElement>, key: ProspectExplorerFieldKey) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    sortBy(key);
  }

  function addFilter() {
    const used = new Set(filters.map((filter) => filter.field));
    const field = columns.find((key) => key !== "business_name" && !used.has(key))
      ?? prospectExplorerFieldList.find((candidate) => !used.has(candidate.key))?.key
      ?? "business_name";
    setFilters((current) => [...current, emptyFilter(field)]);
    setFilterBuilderOpen(true);
  }

  function updateFilter(index: number, next: ProspectCandidateFilter) {
    setFilters((current) => current.map((filter, currentIndex) => currentIndex === index ? next : filter));
  }

  function removeFilter(index: number) {
    setFilters((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function toggleColumn(key: ProspectExplorerFieldKey) {
    if (key === "business_name") return;
    setColumns((current) => current.includes(key) ? current.filter((column) => column !== key) : [...current, key]);
    setColumnWidths((current) => ({ ...current, [key]: current[key] ?? defaultColumnWidth(key) }));
  }

  function moveColumn(index: number, direction: -1 | 1) {
    setColumns((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 1 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function startResize(event: ReactPointerEvent<HTMLSpanElement>, key: ProspectExplorerFieldKey) {
    event.preventDefault();
    event.stopPropagation();
    resizeCleanup.current();
    const startX = event.clientX;
    const startWidth = columnWidths[key] ?? defaultColumnWidth(key);
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      const width = Math.min(maximumColumnWidth, Math.max(minimumColumnWidth, startWidth + moveEvent.clientX - startX));
      setColumnWidths((current) => ({ ...current, [key]: Math.round(width) }));
    };
    const cleanUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanUp);
      window.removeEventListener("pointercancel", cleanUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      resizeCleanup.current = () => undefined;
    };
    resizeCleanup.current = cleanUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanUp);
    window.addEventListener("pointercancel", cleanUp);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLSpanElement>, key: ProspectExplorerFieldKey) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -16 : 16;
    setColumnWidths((current) => ({
      ...current,
      [key]: Math.min(maximumColumnWidth, Math.max(minimumColumnWidth, (current[key] ?? defaultColumnWidth(key)) + delta))
    }));
  }

  return (
    <section className={styles.explorer}>
      <header className={styles.explorerHeader}>
        <div className={styles.resultSummary}>
          <strong>{total.toLocaleString("en-US")} businesses</strong>
          <span>{prospects.length ? `Showing ${firstResult.toLocaleString("en-US")}–${lastResult.toLocaleString("en-US")}` : "No rows in this view"}</span>
        </div>
        <label className={styles.search}>
          <SearchIcon />
          <span className="sr-only">Search businesses</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search business name…" />
        </label>
      </header>

      <div className={styles.viewBar}>
        <label className={styles.viewPicker}>
          <span>View</span>
          <ProductSelect compact value={activeView} onChange={(event) => {
            if (event.target.value !== "custom") applyView(event.target.value as Exclude<ProspectExplorerView, "custom">);
          }}>
            {(Object.keys(prospectExplorerViews) as Array<Exclude<ProspectExplorerView, "custom">>).map((view) => (
              <option value={view} key={view}>{prospectExplorerViews[view].label}</option>
            ))}
            {activeView === "custom" ? <option value="custom">Custom view</option> : null}
          </ProductSelect>
        </label>
        <div className={styles.viewActions}>
          <AdminButton
            type="button"
            size="sm"
            variant={appliedFilters.length ? "secondary" : "ghost"}
            className={appliedFilters.length ? styles.activeQueryButton : undefined}
            aria-expanded={filterBuilderOpen}
            onClick={() => setFilterBuilderOpen((current) => !current)}
          >
            <FilterIcon /> Filter {appliedFilters.length ? <span className={styles.controlCount}>{appliedFilters.length}</span> : null}
          </AdminButton>
          <details className={styles.columnMenu}>
            <summary><ColumnsIcon /> Columns <span>{columns.length}</span></summary>
            <div className={styles.columnPopover}>
              <header><strong>Visible columns</strong><button type="button" onClick={() => setColumns([...defaultProspectExplorerColumns])}>Reset</button></header>
              <div className={styles.selectedColumns}>
                {columns.map((key, index) => <div key={key}>
                  <span>{prospectExplorerFields[key].label}</span>
                  <button type="button" aria-label={`Move ${prospectExplorerFields[key].label} left`} disabled={index <= 1} onClick={() => moveColumn(index, -1)}>←</button>
                  <button type="button" aria-label={`Move ${prospectExplorerFields[key].label} right`} disabled={index === 0 || index >= columns.length - 1} onClick={() => moveColumn(index, 1)}>→</button>
                </div>)}
              </div>
              <div className={styles.availableColumns}>
                {categories.map((category) => <fieldset key={category}>
                  <legend>{category}</legend>
                  {prospectExplorerFieldList.filter((field) => field.category === category).map((field) => <label key={field.key}>
                    <input type="checkbox" checked={columns.includes(field.key)} disabled={field.key === "business_name"} onChange={() => toggleColumn(field.key)} />
                    <span>{field.label}</span>
                  </label>)}
                </fieldset>)}
              </div>
            </div>
          </details>
          <AdminButton type="button" size="sm" variant="ghost" onClick={addFilter}>Add filter</AdminButton>
        </div>
      </div>

      {filterBuilderOpen ? <div className={styles.filterBuilder}>
        <div className={styles.filterBuilderHeading}>
          <span>Show rows where all conditions match</span>
          {filters.length ? <button type="button" onClick={() => setFilters([])}>Clear all</button> : null}
        </div>
        {filters.length ? <div className={styles.filterRows}>{filters.map((filter, index) => <FilterRow
          filter={filter}
          index={index}
          key={`${index}-${filter.field}`}
          onChange={(next) => updateFilter(index, next)}
          onRemove={() => removeFilter(index)}
        />)}</div> : <button className={styles.emptyFilterBuilder} type="button" onClick={addFilter}>+ Add your first condition</button>}
      </div> : null}

      {initialNotice && !error ? <div className={styles.notice}>{initialNotice}</div> : null}
      {error ? <div className={styles.errorNotice} role="alert">{error}</div> : null}
      {loading ? <div className={styles.loadingBar} role="status"><span />Updating rows…</div> : null}

      <div className={styles.tableScroll} role="region" aria-label="Prospect database table" tabIndex={0}>
        <table className={`data-table ${styles.prospectTable}`} style={{ width: Math.max(totalTableWidth, 900) } as CSSProperties}>
          <colgroup>{columns.map((key) => <col key={key} style={{ width: columnWidths[key] ?? defaultColumnWidth(key) }} />)}</colgroup>
          <thead><tr>{columns.map((key) => {
            const field = prospectExplorerFields[key];
            const direction = query.sortBy === key ? query.sortDirection ?? "asc" : undefined;
            return <th
              key={key}
              data-width={field.width}
              aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
            >
              <button type="button" title={`Double-click to sort by ${field.label}`} onDoubleClick={() => sortBy(key)} onKeyDown={(event) => onHeaderKeyDown(event, key)}>
                <span>{field.label}</span><span className={styles.sortMark} aria-hidden="true">{direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}</span>
              </button>
              <span
                className={styles.resizeHandle}
                role="separator"
                aria-label={`Resize ${field.label} column`}
                aria-orientation="vertical"
                tabIndex={0}
                onPointerDown={(event) => startResize(event, key)}
                onKeyDown={(event) => resizeWithKeyboard(event, key)}
              />
            </th>;
          })}</tr></thead>
          <tbody>{prospects.map((prospect) => <tr key={prospect.id}>{columns.map((key) => (
            <td key={key} data-width={prospectExplorerFields[key].width} className={key === "business_name" ? styles.businessCell : undefined} title={plainValue(prospect, key)}>
              {key === "business_name"
                ? <button type="button" onClick={() => setSelected(prospect)}>{prospect.businessName}</button>
                : renderValue(prospect, key)}
            </td>
          ))}</tr>)}</tbody>
        </table>
        {!prospects.length ? <div className={styles.empty}><strong>No businesses match this query.</strong><p>Adjust or clear a filter to see more records.</p></div> : null}
      </div>

      <div className={styles.mobileList}>
        {prospects.map((prospect) => <article className={styles.prospectCard} key={prospect.id}>
          <div><button type="button" onClick={() => setSelected(prospect)}>{prospect.businessName}</button><span className={styles.statusBadge}>{humanize(prospect.researchState)}</span></div>
          <p>{[prospect.primaryLocality, prospect.primaryRegion].filter(Boolean).join(", ") || "Location not researched"}</p>
          <dl>
            <Detail label="Website" value={prospect.websiteUrl} />
            <Detail label="Google reviews" value={prospect.googleReviewCount === undefined ? undefined : prospect.googleReviewCount.toLocaleString("en-US")} />
            <Detail label="Contact" value={prospect.outreachEmail ?? prospect.outreachPhone ?? prospect.businessEmail} />
          </dl>
        </article>)}
        {!prospects.length ? <div className={styles.empty}><strong>No businesses match this query.</strong><p>Adjust or clear a filter to see more records.</p></div> : null}
      </div>

      <footer className={styles.pagination}>
        <label>Rows <ProductSelect compact value={limit} onChange={(event) => setQuery((current) => ({ ...current, limit: Number(event.target.value), offset: 0 }))}>{[50, 100, 250].map((size) => <option value={size} key={size}>{size}</option>)}</ProductSelect></label>
        <span>Page {page.toLocaleString("en-US")} of {pageCount.toLocaleString("en-US")}</span>
        <div>
          <AdminButton type="button" size="sm" disabled={page <= 1 || loading} onClick={() => setQuery((current) => ({ ...current, offset: Math.max(0, offset - limit) }))}>Previous</AdminButton>
          <AdminButton type="button" size="sm" disabled={page >= pageCount || loading} onClick={() => setQuery((current) => ({ ...current, offset: offset + limit }))}>Next</AdminButton>
        </div>
      </footer>

      <ProductDialog open={Boolean(selected)} title={selected?.businessName ?? "Business details"} description={selected ? humanize(selected.researchState) : undefined} size="md" className={styles.detailSheet} onClose={() => setSelected(undefined)} footer={<AdminButton type="button" onClick={() => setSelected(undefined)}>Close</AdminButton>}>
        {selected ? <ProspectDetail prospect={selected} /> : null}
      </ProductDialog>
    </section>
  );
}

function FilterRow({
  filter,
  index,
  onChange,
  onRemove
}: {
  filter: ProspectCandidateFilter;
  index: number;
  onChange: (filter: ProspectCandidateFilter) => void;
  onRemove: () => void;
}) {
  const field = prospectExplorerFields[filter.field];
  const operators = prospectExplorerOperatorsFor(filter.field);
  const needsValue = prospectFilterNeedsValue(filter.operator);
  return <div className={styles.filterRow}>
    <span className={styles.andLabel}>{index ? "AND" : "WHERE"}</span>
    <label><span className="sr-only">Filter field</span><ProductSelect compact value={filter.field} onChange={(event) => onChange(emptyFilter(event.target.value as ProspectExplorerFieldKey))}>
      {categories.map((category) => <optgroup label={category} key={category}>{prospectExplorerFieldList.filter((candidate) => candidate.category === category).map((candidate) => <option value={candidate.key} key={candidate.key}>{candidate.label}</option>)}</optgroup>)}
    </ProductSelect></label>
    <label><span className="sr-only">Filter operator</span><ProductSelect compact value={filter.operator} onChange={(event) => onChange({ ...filter, operator: event.target.value as ProspectCandidateFilter["operator"], value: prospectFilterNeedsValue(event.target.value as ProspectCandidateFilter["operator"]) ? filter.value : undefined })}>
      {operators.map((operator) => <option value={operator} key={operator}>{prospectFilterOperatorLabel(operator, field.kind)}</option>)}
    </ProductSelect></label>
    {needsValue ? <label><span className="sr-only">Filter value</span>{field.options
      ? <ProductSelect compact value={filter.value ?? field.options[0]?.value ?? ""} onChange={(event) => onChange({ ...filter, value: event.target.value })}>{field.options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</ProductSelect>
      : <input type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"} value={filter.value ?? ""} placeholder={`Enter ${field.label.toLowerCase()}`} onChange={(event) => onChange({ ...filter, value: event.target.value })} />}
    </label> : <span className={styles.noValue}>No value needed</span>}
    <button className={styles.removeFilter} type="button" aria-label={`Remove ${field.label} filter`} onClick={onRemove}>×</button>
  </div>;
}

function renderValue(prospect: ProspectCandidate, field: ProspectExplorerFieldKey) {
  const value = prospectExplorerValue(prospect, field);
  if (field === "research_state") return <span className={styles.statusBadge}>{humanizeExplorerValue(prospect.researchState)}</span>;
  if (field === "website_url" && prospect.websiteUrl) return <a href={prospect.websiteUrl} target="_blank" rel="noreferrer">{displayUrl(prospect.websiteUrl)}</a>;
  if (field === "google_website_url" && prospect.googleWebsiteUrl) return <a href={prospect.googleWebsiteUrl} target="_blank" rel="noreferrer">{displayUrl(prospect.googleWebsiteUrl)}</a>;
  if (field === "google_maps_url" && prospect.googleMapsUrl) return <a href={prospect.googleMapsUrl} target="_blank" rel="noreferrer">Open map ↗</a>;
  if (["location_phone", "google_phone", "primary_contact_phone", "outreach_phone"].includes(field) && typeof value === "string") return formatPhone(value);
  if (["created_at", "updated_at"].includes(field) && typeof value === "string") return formatProductDate(value, false);
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (!value) return <span className={styles.nullValue}>NULL</span>;
  return prospectExplorerFields[field].kind === "option" ? humanizeExplorerValue(value) : value;
}

function plainValue(prospect: ProspectCandidate, field: ProspectExplorerFieldKey) {
  const value = prospectExplorerValue(prospect, field);
  if (typeof value === "number") return value.toLocaleString("en-US");
  return value ?? "";
}

function ProspectDetail({ prospect }: { prospect: ProspectCandidate }) {
  const address = prospect.googleAddress ?? [prospect.primaryAddressLine1, prospect.primaryLocality, prospect.primaryRegion, prospect.primaryPostalCode].filter(Boolean).join(", ");
  return <div className={styles.detailContent}>
    <section className={styles.detailGroup}><h3>Business</h3><dl>
      <Detail label="Research state" value={humanize(prospect.researchState)} />
      <Detail label="Industry" value={prospect.vertical} />
      <Detail label="Address" value={address} />
      <Detail label="Google category" value={prospect.googleCategory} />
      <Detail label="Google Place ID" value={prospect.googlePlaceId} code />
      <Detail label="Google reviews" value={prospect.googleReviewCount === undefined ? undefined : `${prospect.googleRating ?? "—"} · ${prospect.googleReviewCount.toLocaleString("en-US")} reviews`} />
    </dl></section>
    <section className={styles.detailGroup}><h3>Website</h3><dl>
      <LinkedDetail label="Website" value={prospect.websiteUrl} />
      <Detail label="Platform" value={prospect.websitePlatform} />
      <Detail label="Agency provider" value={prospect.websiteAgencyProvider} />
    </dl></section>
    <section className={styles.contactSection}>
      <header><h3>Contacts</h3><span>{prospect.contacts.length} sourced</span></header>
      <dl className={styles.primaryContacts}>
        <Detail label="Primary contact" value={prospect.primaryContactName} />
        <Detail label="Role" value={prospect.primaryContactRole} />
        <LinkedDetail label="Primary email" value={prospect.primaryContactEmail} email />
        <LinkedDetail label="Primary phone" value={prospect.primaryContactPhone} phone />
        <LinkedDetail label="Business email" value={prospect.businessEmail} email />
        <LinkedDetail label="Outreach email" value={prospect.outreachEmail} email />
        <LinkedDetail label="Outreach phone" value={prospect.outreachPhone} phone />
      </dl>
      <ContactSourceStamp contacts={prospect.contacts} />
    </section>
  </div>;
}

function ContactSourceStamp({ contacts }: { contacts: ProspectCandidateContact[] }) {
  if (!contacts.length) return <p>No contact source records are attached to this prospect.</p>;
  return <details className={styles.contactSources}>
    <summary>View sources ({contacts.length})</summary>
    <ul>{contacts.map((contact) => <li key={contact.id}>
      <strong>{contact.fullName}{contact.isPrimary ? " · Primary" : ""}</strong>
      <span>{[contact.roleTitle, contact.email, contact.phone ? formatPhone(contact.phone) : undefined].filter(Boolean).join(" · ")}</span>
      <small>Prospect contact record {contact.id}</small>
    </li>)}</ul>
  </details>;
}

function Detail({ label, value, code = false }: { label: string; value?: string; code?: boolean }) {
  return <div><dt>{label}</dt><dd>{value ? code ? <code>{value}</code> : value : "—"}</dd></div>;
}

function LinkedDetail({ label, value, email = false, phone = false }: { label: string; value?: string; email?: boolean; phone?: boolean }) {
  const href = value ? email ? `mailto:${value}` : phone ? `tel:${value}` : value : undefined;
  return <div><dt>{label}</dt><dd>{value && href ? <a href={href} target={email || phone ? undefined : "_blank"} rel={email || phone ? undefined : "noreferrer"}>{phone ? formatPhone(value) : value}</a> : "—"}</dd></div>;
}

function emptyFilter(field: ProspectExplorerFieldKey): ProspectCandidateFilter {
  const definition = prospectExplorerFields[field];
  return {
    field,
    operator: defaultProspectFilterOperator(field),
    value: definition.options?.[0]?.value
  };
}

function filterIsReady(filter: ProspectCandidateFilter) {
  if (!prospectFilterNeedsValue(filter.operator)) return true;
  if (!filter.value?.trim()) return false;
  const field = prospectExplorerFields[filter.field];
  if (field.kind === "number") return Number.isFinite(Number(filter.value));
  if (field.kind === "date") return !Number.isNaN(Date.parse(filter.value));
  return !field.options || field.options.some((option) => option.value === filter.value);
}

function sameFilterList(left: ProspectCandidateFilter[], right: ProspectCandidateFilter[]) {
  return left.length === right.length && left.every((filter, index) => {
    const other = right[index];
    return filter.field === other?.field && filter.operator === other.operator && (filter.value ?? "") === (other.value ?? "");
  });
}

function sameColumnList(left: ProspectExplorerFieldKey[], right: ProspectExplorerFieldKey[]) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function defaultColumnWidth(key: ProspectExplorerFieldKey) {
  if (key === "business_name") return 360;
  const width = prospectExplorerFields[key].width;
  return width === "compact" ? 128 : width === "wide" ? 260 : 180;
}

function displayUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value;
  }
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return value;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></svg>;
}

function FilterIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
}

function ColumnsIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="M10 5v14M15 5v14" /></svg>;
}
