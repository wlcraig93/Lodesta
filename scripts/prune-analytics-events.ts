import "./load-env";
import assert from "node:assert/strict";
import { getSupabaseAdminClient } from "../lib/supabase/client";

const confirmed = process.argv.includes("--confirm");
assert(confirmed, "Analytics retention deletes raw events. Re-run with --confirm after reviewing the 14-month boundary.");

const before = new Date();
before.setUTCMonth(before.getUTCMonth() - 14);
const { data, error } = await getSupabaseAdminClient().rpc("prune_analytics_events", {
  p_before: before.toISOString()
});
if (error) throw new Error(`Prune analytics events: ${error.message}`);

console.log(JSON.stringify({ ok: true, before: before.toISOString(), deletedEvents: data ?? 0 }));
