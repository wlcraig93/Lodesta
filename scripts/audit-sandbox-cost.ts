import "./load-env";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { sha256, stableJson } from "../packages/business-data";

const client = getSupabaseAdminClient();
const reportPath = resolve(process.cwd(), ".data/maintenance/sandbox-cost-audit.json");
const memoryGiB = positiveNumber(process.env.LODESTA_SANDBOX_MEMORY_GIB ?? "6", "LODESTA_SANDBOX_MEMORY_GIB");
const ratePerGiBSecond = optionalPositiveNumber(process.env.LODESTA_CLOUDFLARE_MEMORY_USD_PER_GIB_SECOND, "LODESTA_CLOUDFLARE_MEMORY_USD_PER_GIB_SECOND");
const now = new Date();
const rows = await loadSessions();
const sessions = rows.map((row) => {
  const retainedMs = nonnegativeInteger(row.sandbox_provisioned_ms, "sandbox_provisioned_ms");
  const activeMs = typeof row.sandbox_id === "string" && row.sandbox_id && typeof row.sandbox_last_started_at === "string"
    ? Math.max(0, now.getTime() - Date.parse(row.sandbox_last_started_at))
    : 0;
  const provisionedMs = retainedMs + activeMs;
  const giBSeconds = provisionedMs / 1000 * memoryGiB;
  return {
    id: requiredString(row.id, "session.id"),
    siteId: requiredString(row.site_id, "session.site_id"),
    status: requiredString(row.status, "session.status"),
    hasLiveSandbox: Boolean(row.sandbox_id),
    provisionedMs,
    giBSeconds: round(giBSeconds, 6),
    estimatedMemoryCostUsd: ratePerGiBSecond === undefined ? undefined : round(giBSeconds * ratePerGiBSecond, 6),
    destroyAttempts: nonnegativeInteger(row.sandbox_destroy_attempts, "sandbox_destroy_attempts")
  };
}).sort((left, right) => left.id.localeCompare(right.id));
const bySite = Object.values(sessions.reduce<Record<string, { siteId: string; sessions: number; liveSandboxes: number; provisionedMs: number; giBSeconds: number; estimatedMemoryCostUsd?: number }>>((result, session) => {
  const item = result[session.siteId] ?? { siteId: session.siteId, sessions: 0, liveSandboxes: 0, provisionedMs: 0, giBSeconds: 0, estimatedMemoryCostUsd: ratePerGiBSecond === undefined ? undefined : 0 };
  item.sessions += 1;
  item.liveSandboxes += Number(session.hasLiveSandbox);
  item.provisionedMs += session.provisionedMs;
  item.giBSeconds += session.giBSeconds;
  if (item.estimatedMemoryCostUsd !== undefined) item.estimatedMemoryCostUsd += session.estimatedMemoryCostUsd ?? 0;
  result[session.siteId] = item;
  return result;
}, {})).map((item) => ({
  ...item,
  giBSeconds: round(item.giBSeconds, 6),
  estimatedMemoryCostUsd: item.estimatedMemoryCostUsd === undefined ? undefined : round(item.estimatedMemoryCostUsd, 6)
})).sort((left, right) => left.siteId.localeCompare(right.siteId));
const totals = {
  sessions: sessions.length,
  liveSandboxes: sessions.filter((session) => session.hasLiveSandbox).length,
  provisionedMs: sessions.reduce((total, session) => total + session.provisionedMs, 0),
  giBSeconds: round(sessions.reduce((total, session) => total + session.giBSeconds, 0), 6),
  estimatedMemoryCostUsd: ratePerGiBSecond === undefined ? undefined : round(sessions.reduce((total, session) => total + (session.estimatedMemoryCostUsd ?? 0), 0), 6)
};
const payload = {
  schemaVersion: "sandbox-cost-audit-v1",
  estimationBasis: "session-wall-time-upper-bound",
  memoryGiB,
  ratePerGiBSecond,
  totals,
  bySite,
  sessions
};
const report = { ...payload, createdAt: now.toISOString(), reportHash: sha256(stableJson(payload)) };
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, reportPath, reportHash: report.reportHash, totals })}\n`);

async function loadSessions() {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("site_agent_sessions").select("id,site_id,status,sandbox_id,sandbox_last_started_at,sandbox_provisioned_ms,sandbox_destroy_attempts").range(from, from + 999);
    if (error) throw new Error(`Load sandbox cost telemetry: ${error.message}`);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value) throw new Error(`${name} is invalid.`);
  return value;
}

function nonnegativeInteger(value: unknown, name: string) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} is invalid.`);
  return parsed;
}

function positiveNumber(value: string, name: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number.`);
  return parsed;
}

function optionalPositiveNumber(value: string | undefined, name: string) {
  return value === undefined || value === "" ? undefined : positiveNumber(value, name);
}

function round(value: number, digits: number) {
  return Number(value.toFixed(digits));
}
