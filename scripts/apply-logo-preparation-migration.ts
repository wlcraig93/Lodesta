import "./load-env";

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

assert(process.argv.includes("--apply"), "Pass --apply to run the reviewed logo-preparation migration.");
assert(process.argv.includes("--environment=nonproduction"), "This cutover command is restricted to --environment=nonproduction.");
const databaseUrlValue = process.env.SUPABASE_SESSION_POOLER_URL?.trim();
assert(databaseUrlValue, "SUPABASE_SESSION_POOLER_URL is required.");
const databaseUrl = new URL(databaseUrlValue);
assert(["postgres:", "postgresql:"].includes(databaseUrl.protocol), "SUPABASE_SESSION_POOLER_URL must be a Postgres URL.");

const execute = promisify(execFile);
const postgresEnvironment = {
  ...process.env,
  PGHOST: databaseUrl.hostname,
  PGPORT: databaseUrl.port || "5432",
  PGDATABASE: decodeURIComponent(databaseUrl.pathname.replace(/^\//, "")),
  PGUSER: decodeURIComponent(databaseUrl.username),
  PGPASSWORD: decodeURIComponent(databaseUrl.password),
  PGSSLMODE: databaseUrl.searchParams.get("sslmode") || "require"
};
const migrationPath = "supabase/migrations/202608140001_immutable_logo_preparation_revisions.sql";
const migration = await readFile(migrationPath, "utf8");
assert.match(migration, /drop index if exists public\.asset_revisions_business_content_hash_idx/);
assert.match(migration, /create index asset_revisions_business_content_hash_idx/);

const { stdout: columnOutput } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  "select column_name from information_schema.columns where table_schema = 'supabase_migrations' and table_name = 'schema_migrations' order by ordinal_position;"
], { env: postgresEnvironment, maxBuffer: 100_000 });
const columns = columnOutput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
assert(columns.includes("version") && columns.includes("name") && columns.includes("statements"), "Unexpected Supabase migration ledger shape.");

const ledgerVersion = "202608140001";
const ledgerName = "immutable_logo_preparation_revisions";
const transaction = [
  "begin;",
  migration,
  `insert into supabase_migrations.schema_migrations(version, name, statements) values ('${ledgerVersion}', '${ledgerName}', array[]::text[]) on conflict (version) do nothing;`,
  "commit;"
].join("\n");
await execute("psql", [
  "--no-psqlrc",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  transaction
], { env: postgresEnvironment, maxBuffer: 1_000_000 });

const { stdout: verification } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  "select i.indisunique::text || ':' || c.relname from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'asset_revisions_business_content_hash_idx';"
], { env: postgresEnvironment, maxBuffer: 100_000 });
assert.equal(verification.trim(), "false:asset_revisions_business_content_hash_idx");

process.stdout.write(`${JSON.stringify({ ok: true, environment: "nonproduction", migration: migrationPath, ledgerVersion })}\n`);
