import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { siteVersionSchema } from "../packages/site-contracts";

assert.equal(process.env.LODESTA_REPOSITORY, "supabase");
assert(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const report = {
  at: new Date().toISOString(), readOnly: true, rows: 0, storedValid: 0, projectedValid: 0,
  storedFailures: [] as Array<{ id: string; status: string; paths: string[] }>,
  projectedFailures: [] as Array<{ id: string; status: string; paths: string[] }>,
  timestampExamples: [] as Array<{ id: string; embedded: unknown; column: unknown }>
};
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await client.from("site_versions")
    .select("id,version,status,published_at,replaced_version_id,stale_reason")
    .order("id").range(offset, offset + 999);
  if (error) throw error;
  for (const row of data) {
    report.rows++;
    const stored = siteVersionSchema.safeParse(row.version);
    const projected = siteVersionSchema.safeParse({ ...row.version,
      status: row.status, publishedAt: row.published_at ?? undefined,
      replacedVersionId: row.replaced_version_id ?? undefined, staleReason: row.stale_reason ?? undefined });
    if (stored.success) report.storedValid++;
    else report.storedFailures.push({ id: row.id, status: row.status, paths: stored.error.issues.map(issue => issue.path.join(".")) });
    if (projected.success) report.projectedValid++;
    else report.projectedFailures.push({ id: row.id, status: row.status, paths: projected.error.issues.map(issue => issue.path.join(".")) });
    if (row.version?.publishedAt && !stored.success && report.timestampExamples.length < 5) {
      report.timestampExamples.push({ id: row.id, embedded: row.version.publishedAt, column: row.published_at });
    }
  }
  if (data.length < 1000) break;
}
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice("--output=".length);
if (output) await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
