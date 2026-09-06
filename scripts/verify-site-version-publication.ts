import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SupabaseSitePlatformRepository } from "../packages/platform-data";
import { siteVersionSchema } from "../packages/site-contracts";

const version = siteVersionSchema.parse({
  schemaVersion: 1, id: "version_publication_fixture", siteId: "site_publication_fixture",
  number: 1, status: "candidate", artifactId: "artifact_fixture", artifactHash: `sha256:${"a".repeat(64)}`,
  workspaceRevisionId: "workspace_fixture", publicBuildInputId: "input_fixture",
  ownerOperationalRevision: 1, ownerIntentRevision: 1,
  formDefinitionIds: [], sourceSnapshotIds: [], assetRevisionIds: [],
  createdAt: "2026-09-06T20:00:00.000Z", createdBy: { kind: "owner", id: "owner_fixture" }
});
const timestamp = "2026-09-06T21:07:23.65587+00:00";
const publicationRow = {
  version: { ...version, status: "published", publishedAt: "2026-09-06 21:07:23.65587+00" },
  status: "published", published_at: timestamp, replaced_version_id: null, stale_reason: null
};
let row: Record<string, unknown> = structuredClone(publicationRow);
const repository = new SupabaseSitePlatformRepository();
const query = {
  select() { return this; }, eq() { return this; }, order() { return this; },
  async maybeSingle() { return { data: row, error: null }; },
  then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [row], error: null }).then(resolve); }
};
Object.defineProperty(repository, "client", { value: { from(table: string) {
  assert.equal(table, "site_versions"); return query;
} } });

const before = JSON.stringify(row);
const published = await repository.getSiteVersion(version.id);
assert.equal(published?.status, "published");
assert.equal(published?.publishedAt, timestamp);
assert.equal(published?.artifactHash, version.artifactHash);
assert.equal(JSON.stringify(row), before, "Reading publication metadata must not rewrite the retained payload.");
const listed = await repository.listSiteVersions(version.siteId);
assert.equal(listed[0].publishedAt, timestamp);

row = { ...publicationRow, published_at: "not-a-timestamp" };
await assert.rejects(() => repository.getSiteVersion(version.id), /publishedAt/);
row = { ...publicationRow, version: { ...publicationRow.version, artifactHash: "invalid" } };
await assert.rejects(() => repository.getSiteVersion(version.id), /artifactHash/);
row = { ...publicationRow, version: { ...publicationRow.version, createdAt: "2026-09-06 20:00:00+00" } };
await assert.rejects(() => repository.getSiteVersion(version.id), /createdAt/);
row = { ...publicationRow, status: "candidate", published_at: null };
assert.equal((await repository.getSiteVersion(version.id))?.publishedAt, undefined);
const previousMigration = await readFile("supabase/migrations/202607300001_simplified_site_authoring.sql", "utf8");
const migration = await readFile("supabase/migrations/202609060001_site_publication_timestamp.sql", "utf8");
const definition = /create or replace function public\.promote_site_version\([\s\S]*?grant execute on function public\.promote_site_version\(text,text\) to service_role;/;
const previousDefinition = previousMigration.match(definition)?.[0];
assert(previousDefinition);
assert.equal(migration.match(definition)?.[0], previousDefinition.replace("to_jsonb(now()::text)", "to_jsonb(now())"),
  "The forward migration must change serialization only, preserving every publication integrity and owner check.");
console.log(JSON.stringify({ ok: true, publicationColumns: "authoritative", retainedPayload: "unchanged", invalidAuthority: "rejected" }));
