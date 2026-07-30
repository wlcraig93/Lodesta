import { AdminButtonLink } from "@/components/admin/AdminButton";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { formatProductDate, humanize } from "@/lib/product-format";
import { requireAdminPageAccess } from "@/lib/page-access";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import type { ProspectCandidateQuery } from "@/packages/prospect-research";
import styles from "./prospects.module.css";

export const dynamic = "force-dynamic";

type RawSearchParams = Record<string, string | string[] | undefined>;

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireAdminPageAccess("/prospects");
  const raw = await searchParams;
  const pageSize = pageSizeValue(single(raw.pageSize));
  const filteredQuery = prospectQuery(raw);
  const total = await repository.countProspectCandidates(filteredQuery);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(positiveInteger(single(raw.page), 1), pageCount);
  const query = {
    ...filteredQuery,
    offset: (page - 1) * pageSize,
    limit: pageSize
  };
  const prospects = await repository.listProspectCandidates(query);
  const assessmentIds = prospects.flatMap((prospect) => prospect.websiteAssessmentId ? [prospect.websiteAssessmentId] : []);
  const assessments = assessmentIds.length
    ? await repository.listWebsiteAssessments({ ids: assessmentIds, limit: assessmentIds.length })
    : [];
  const assessmentsById = new Map(assessments.map((assessment) => [assessment.id, assessment]));
  const scored = prospects.filter((prospect) => prospect.priorityScore !== undefined).length;
  const reachable = prospects.filter((prospect) => !prospect.doNotContact && (prospect.publicEmail || prospect.phone)).length;
  const unserved = prospects.filter((prospect) => prospect.websiteKind !== "owned_website").length;
  const verified = prospects.filter((prospect) => prospect.verificationStatus === "verified").length;
  const targetFit = prospects.filter((prospect) => prospect.targetFitStatus === "target").length;

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Market research"
        title="Prospect inventory"
        description="One durable business record, append-only research observations, and sourced contacts. Ranking is a prioritization aid; campaign selection preserves the exact observation used."
      />

      <section className={`metric-row ${styles.metrics}`}>
        <Metric label="Matching prospects" value={total.toLocaleString("en-US")} />
        <Metric label="Showing" value={prospects.length ? `${query.offset + 1}–${query.offset + prospects.length}` : "0"} />
        <Metric label="Scored on page" value={scored} />
        <Metric label="Reachable on page" value={reachable} />
        <Metric label="Verified on page" value={verified} />
        <Metric label="Target fit on page" value={targetFit} />
        <Metric label="No owned site on page" value={unserved} />
      </section>

      <section className={`panel ${styles.inventory}`}>
        <form className={styles.filters} method="get">
          <Field label="Business">
            <input name="search" defaultValue={single(raw.search)} placeholder="Name or keyword" />
          </Field>
          <Field label="Vertical">
            <select name="vertical" defaultValue={defaultVertical(raw)}>
              <option value="pest_control">Pest control</option>
              <option value="">All verticals</option>
              <option value="plumbing">Plumbing</option>
              <option value="hvac">HVAC</option>
              <option value="landscaping_tree">Landscaping / tree</option>
            </select>
          </Field>
          <Field label="State">
            <input name="region" defaultValue={single(raw.region)} placeholder="TX" maxLength={2} />
          </Field>
          <Field label="Website">
            <select name="websiteKind" defaultValue={single(raw.websiteKind)}>
              <option value="">All</option>
              <option value="owned_website">Owned website</option>
              <option value="no_website">No website</option>
              <option value="social_or_aggregator">Social / aggregator</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>
          <Field label="CMS / builder">
            <input name="cms" defaultValue={single(raw.cms)} placeholder="WordPress" />
          </Field>
          <Field label="Provider">
            <input name="managedProvider" defaultValue={single(raw.managedProvider)} placeholder="Hibu" />
          </Field>
          <Field label="Agency">
            <select name="agencyStatus" defaultValue={single(raw.agencyStatus)}>
              <option value="">All</option>
              <option value="confirmed">Confirmed</option>
              <option value="likely">Likely</option>
              <option value="not_observed">Not observed</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>
          <Field label="Verification">
            <select name="verificationStatus" defaultValue={single(raw.verificationStatus)}>
              <option value="">All</option>
              <option value="verified">Verified</option>
              <option value="partial">Partial</option>
              <option value="conflicted">Conflicted</option>
              <option value="rejected">Rejected</option>
              <option value="unverified">Unverified</option>
            </select>
          </Field>
          <Field label="Operating">
            <select name="operatingStatus" defaultValue={single(raw.operatingStatus)}>
              <option value="">All</option>
              <option value="operational">Operational</option>
              <option value="temporarily_closed">Temporarily closed</option>
              <option value="permanently_closed">Permanently closed</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>
          <Field label="Target fit">
            <select name="targetFitStatus" defaultValue={single(raw.targetFitStatus)}>
              <option value="">All</option>
              <option value="target">Target</option>
              <option value="review_required">Review required</option>
              <option value="excluded">Excluded</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>
          <Field label="Min reviews">
            <input name="minimumReviewCount" type="number" min={0} defaultValue={single(raw.minimumReviewCount)} placeholder="0" />
          </Field>
          <Field label="Min priority">
            <input name="minimumPriorityScore" type="number" min={0} max={100} defaultValue={single(raw.minimumPriorityScore)} placeholder="0" />
          </Field>
          <Field label="Min verification">
            <input name="minimumVerificationScore" type="number" min={0} max={100} defaultValue={single(raw.minimumVerificationScore)} placeholder="0" />
          </Field>
          <Field label="Sort by">
            <select name="sortBy" defaultValue={single(raw.sortBy) || "business_name"}>
              <option value="business_name">Business name</option>
              <option value="state">State</option>
              <option value="priority">Priority score</option>
              <option value="reviews">Review count</option>
              <option value="verification">Verification score</option>
              <option value="observed_at">Most recently observed</option>
            </select>
          </Field>
          <Field label="Direction">
            <select name="sortDirection" defaultValue={single(raw.sortDirection) || defaultSortDirection(single(raw.sortBy) || "business_name")}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </Field>
          <Field label="Rows per page">
            <select name="pageSize" defaultValue={String(pageSize)}>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
            </select>
          </Field>
          <div className={styles.filterActions}>
            <button className="admin-button admin-button-primary admin-button-md" type="submit">Apply</button>
            <AdminButtonLink href="/prospects" variant="ghost">Reset</AdminButtonLink>
          </div>
        </form>

        <div className={styles.tableScroll} role="region" aria-label="Prospect inventory" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Verification</th>
                <th>Business</th>
                <th>Market</th>
                <th>Website</th>
                <th>Demand</th>
                <th>Contact</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((prospect) => {
                const assessment = prospect.websiteAssessmentId
                  ? assessmentsById.get(prospect.websiteAssessmentId)?.assessment
                  : undefined;
                const websiteScore = websiteAssessmentScore(assessment);
                return (
                  <tr key={prospect.id}>
                    <td>
                      <strong className={styles.score}>{formatScore(prospect.priorityScore)}</strong>
                      <small>{prospect.scoringModel ?? "not scored"}</small>
                    </td>
                    <td>
                      <strong>{humanize(prospect.verificationStatus ?? "unverified")}</strong>
                      <small>
                        {prospect.verificationScore === undefined ? "Not scored" : `${Math.round(prospect.verificationScore)}% match`}
                        {prospect.operatingStatus ? ` · ${humanize(prospect.operatingStatus)}` : ""}
                        {prospect.targetFitStatus ? ` · ${humanize(prospect.targetFitStatus)}` : ""}
                      </small>
                    </td>
                    <td>
                      <strong>{prospect.businessName}</strong>
                      <small>{prospect.vertical ?? prospect.industryCode ?? "unclassified"} · {prospect.doNotContact ? "do not contact" : prospect.status}</small>
                    </td>
                    <td>
                      {[prospect.locality, prospect.region].filter(Boolean).join(", ") || "Unknown"}
                      <small>{prospect.postalCode ?? prospect.countryCode}</small>
                    </td>
                    <td>
                      {prospect.websiteUrl ? (
                        <a href={prospect.websiteUrl} target="_blank" rel="noreferrer">{prospect.websiteHost ?? "Website"}</a>
                      ) : humanize(prospect.websiteKind)}
                      <small>
                        {[prospect.cms, prospect.siteBuilder, prospect.managedProvider].filter(Boolean).join(" · ") || "Provider unknown"}
                        {websiteScore === undefined ? "" : ` · Website score ${Math.round(websiteScore)}`}
                      </small>
                    </td>
                    <td>
                      {prospect.reviewCount !== undefined ? `${prospect.reviewCount} reviews` : "Not observed"}
                      <small>{prospect.reviewRating !== undefined ? `${prospect.reviewRating.toFixed(1)} rating` : "Rating unknown"}</small>
                    </td>
                    <td>
                      {prospect.doNotContact
                        ? "Suppressed"
                        : prospect.ownerName ?? prospect.publicEmail ?? prospect.phone ?? "Not sourced"}
                      <small>{prospect.doNotContact ? prospect.suppressionReason : prospect.publicEmail ?? `${prospect.contactCount} sourced contact${prospect.contactCount === 1 ? "" : "s"}`}</small>
                    </td>
                    <td>
                      {Math.round((prospect.evidenceCoverage ?? 0) * 100)}% coverage
                      <small>{prospect.latestObservedAt ? `Observed ${formatProductDate(prospect.latestObservedAt, false)}` : "No observation"}</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!prospects.length ? (
            <div className={styles.empty}>
              <strong>No prospects match these filters.</strong>
              <p>Reset the filters or import a research batch.</p>
            </div>
          ) : null}
        </div>

        <nav className={styles.pagination} aria-label="Prospect inventory pagination">
          <p>
            Page {page.toLocaleString("en-US")} of {pageCount.toLocaleString("en-US")}
            {" · "}
            {total.toLocaleString("en-US")} matching prospects
          </p>
          <div>
            {page > 1 ? (
              <AdminButtonLink href={pageHref(raw, page - 1)} variant="ghost">Previous</AdminButtonLink>
            ) : <span className={styles.disabledPageAction}>Previous</span>}
            {page < pageCount ? (
              <AdminButtonLink href={pageHref(raw, page + 1)} variant="ghost">Next</AdminButtonLink>
            ) : <span className={styles.disabledPageAction}>Next</span>}
          </div>
        </nav>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span>{label}</span>{children}</label>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>;
}

function prospectQuery(raw: RawSearchParams): ProspectCandidateQuery {
  return {
    search: single(raw.search) || undefined,
    vertical: defaultVertical(raw) || undefined,
    region: single(raw.region) || undefined,
    websiteKind: enumValue(single(raw.websiteKind), ["owned_website", "no_website", "social_or_aggregator", "unknown"] as const),
    cms: single(raw.cms) || undefined,
    managedProvider: single(raw.managedProvider) || undefined,
    agencyStatus: enumValue(single(raw.agencyStatus), ["confirmed", "likely", "not_observed", "unknown"] as const),
    verificationStatus: enumValue(single(raw.verificationStatus), ["unverified", "partial", "verified", "conflicted", "rejected"] as const),
    operatingStatus: enumValue(single(raw.operatingStatus), ["unknown", "operational", "temporarily_closed", "permanently_closed"] as const),
    targetFitStatus: enumValue(single(raw.targetFitStatus), ["unknown", "target", "review_required", "excluded"] as const),
    minimumReviewCount: numberValue(single(raw.minimumReviewCount)),
    minimumPriorityScore: numberValue(single(raw.minimumPriorityScore)),
    minimumVerificationScore: numberValue(single(raw.minimumVerificationScore)),
    sortBy: enumValue(single(raw.sortBy) || "business_name", ["priority", "business_name", "state", "reviews", "verification", "observed_at"] as const),
    sortDirection: enumValue(
      single(raw.sortDirection) || defaultSortDirection(single(raw.sortBy) || "business_name"),
      ["asc", "desc"] as const
    )
  };
}

function defaultVertical(raw: RawSearchParams) {
  return Object.hasOwn(raw, "vertical") ? single(raw.vertical) : "pest_control";
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function numberValue(value: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pageSizeValue(value: string) {
  const parsed = positiveInteger(value, 100);
  return [50, 100, 250].includes(parsed) ? parsed : 100;
}

function defaultSortDirection(sortBy: string) {
  return ["business_name", "state"].includes(sortBy) ? "asc" : "desc";
}

function pageHref(raw: RawSearchParams, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const current = Array.isArray(value) ? value[0] : value;
    if (current !== undefined && key !== "page") params.set(key, current);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/prospects?${query}` : "/prospects";
}

function enumValue<T extends string>(value: string, values: readonly T[]): T | undefined {
  return values.includes(value as T) ? value as T : undefined;
}

function formatScore(value?: number) {
  return value === undefined ? "—" : Math.round(value).toString();
}

function websiteAssessmentScore(value: unknown) {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.grade) && typeof value.grade.value === "number") return value.grade.value;
  if (!isRecord(value.score)) return undefined;
  if (typeof value.score.value === "number") return value.score.value;
  if (
    isRecord(value.score.scopes)
    && isRecord(value.score.scopes.siteAuthor)
    && typeof value.score.scopes.siteAuthor.value === "number"
  ) {
    return value.score.scopes.siteAuthor.value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
