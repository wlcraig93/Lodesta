import "./load-env";

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

assert(process.argv.includes("--apply"), "Pass --apply to run the reviewed canonical-source-logo migration.");
assert(process.argv.includes("--environment=nonproduction"), "This migration command is restricted to --environment=nonproduction.");
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
const migrationPath = "supabase/migrations/202608140002_canonical_source_logo_recapture.sql";
const migration = await readFile(migrationPath, "utf8");
assert.match(migration, /apply_prepared_source_recapture\(\s*target_expected_public_input_id text,\s*asset_documents jsonb,\s*state_document jsonb,/s);

const ledgerVersion = "202608140002";
const ledgerName = "canonical_source_logo_recapture";
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
  "select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'apply_prepared_source_recapture';"
], { env: postgresEnvironment, maxBuffer: 100_000 });
assert.equal(verification.trim(), "target_expected_public_input_id text, asset_documents jsonb, state_document jsonb, public_input_document jsonb");

process.stdout.write(`${JSON.stringify({ ok: true, environment: "nonproduction", migration: migrationPath, ledgerVersion })}\n`);
