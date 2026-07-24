import "./load-env";
import assert from "node:assert/strict";
import { getSupabaseAdminClient } from "../lib/supabase/client";

const admin = getSupabaseAdminClient();

const [
  activePublishedSites,
  analyticsEvents,
  retainedVersions,
  runtimeSeries
] = await Promise.all([
  count("sites", (query) => query.eq("status", "active").not("published_version_id", "is", null)),
  count("analytics_events"),
  count("site_versions"),
  count("trusted_runtime_series")
]);

const report = {
  generatedAt: new Date().toISOString(),
  activePublishedSites,
  analyticsEvents,
  retainedVersions,
  runtimeSeries,
  cleanCutAllowed: activePublishedSites === 0 && analyticsEvents === 0
};

console.log(JSON.stringify(report, null, 2));
assert(
  report.cleanCutAllowed,
  "Analytics clean cut is blocked: active published sites or retained analytics events exist. Obtain an explicit operator cutover decision."
);

async function count(
  table: string,
  scope?: (query: any) => any
) {
  const base = admin.from(table).select("*", { count: "exact", head: true });
  const query = scope ? scope(base) : base;
  const { count: value, error } = await query;
  if (error) throw new Error(`Count ${table}: ${error.message}`);
  return value ?? 0;
}
