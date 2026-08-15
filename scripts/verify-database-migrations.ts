import "./load-env";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const environment = process.argv
  .find((argument) => argument.startsWith("--environment="))
  ?.slice("--environment=".length);
assert(
  environment === "nonproduction" || environment === "production",
  "Pass --environment=nonproduction or --environment=production."
);

const databaseUrlValue = process.env.LODESTA_CUTOVER_DATABASE_URL?.trim()
  || (environment === "nonproduction" ? process.env.SUPABASE_SESSION_POOLER_URL?.trim() : undefined);
assert(
  databaseUrlValue,
  environment === "production"
    ? "LODESTA_CUTOVER_DATABASE_URL is required for production migration-ledger verification."
    : "LODESTA_CUTOVER_DATABASE_URL or SUPABASE_SESSION_POOLER_URL is required for non-production migration-ledger verification."
);
const databaseUrl = new URL(databaseUrlValue);
assert(["postgres:", "postgresql:"].includes(databaseUrl.protocol), "LODESTA_CUTOVER_DATABASE_URL must be a Postgres URL.");

const migrationDirectory = "supabase/migrations";
const migrationFiles = (await readdir(migrationDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const localVersions = migrationFiles.map((name) => {
  const version = name.match(/^(\d{12})_/)?.[1];
  assert(version, `Migration ${name} does not start with a 12-digit version.`);
  return version;
});
assert.equal(new Set(localVersions).size, localVersions.length, "Repository migration versions are not unique.");

const postgresEnvironment = {
  ...process.env,
  PGHOST: databaseUrl.hostname,
  PGPORT: databaseUrl.port || "5432",
  PGDATABASE: decodeURIComponent(databaseUrl.pathname.replace(/^\//, "")),
  PGUSER: decodeURIComponent(databaseUrl.username),
  PGPASSWORD: decodeURIComponent(databaseUrl.password),
  PGSSLMODE: databaseUrl.searchParams.get("sslmode") || "require"
};
const { stdout } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  "select version from supabase_migrations.schema_migrations order by version;"
], {
  env: postgresEnvironment,
  maxBuffer: 1_000_000
});
const remoteVersions = stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
assert.deepEqual(
  remoteVersions,
  localVersions,
  `${environment} migration ledger differs from the reviewed repository sequence.`
);

const { stdout: indexOutput } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  "select indexname from pg_indexes where schemaname = 'public' and indexname in ('site_versions_one_candidate_idx','site_agent_runs_one_running_per_site_idx','site_agent_runs_claim_queue_idx') order by indexname;"
], {
  env: postgresEnvironment,
  maxBuffer: 1_000_000
});
assert.deepEqual(
  indexOutput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
  [
    "site_agent_runs_claim_queue_idx",
    "site_agent_runs_one_running_per_site_idx",
    "site_versions_one_candidate_idx"
  ],
  `${environment} is missing a canonical candidate or worker-queue index.`
);

const { stdout: removedMcpSchemaOutput } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  `
    select 'table:' || tablename
      from pg_tables
      where schemaname = 'public'
        and tablename in (
          'external_authoring_executions',
          'external_authoring_claims',
          'external_authoring_operations',
          'external_authoring_credentials',
          'external_authoring_credential_requests',
          'authoring_execution_bundles',
          'staged_blob_receipts'
        )
    union all
    select 'column:' || column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'site_agent_runs'
        and column_name = 'execution_driver'
    union all
    select 'function:' || proname
      from pg_proc
      join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
      where pg_namespace.nspname = 'public'
        and proname in (
          'claim_next_external_authoring',
          'requeue_external_authoring_execution',
          'expire_external_authoring_execution_deadlines',
          'cancel_external_authoring_batch',
          'reserve_external_authoring_operation',
          'complete_external_authoring_operation',
          'fail_external_authoring_operation'
        )
    order by 1;
  `
], {
  env: postgresEnvironment,
  maxBuffer: 1_000_000
});
assert.deepEqual(
  removedMcpSchemaOutput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
  [],
  `${environment} still exposes removed MCP authoring schema.`
);

const { stdout: finalizerOutput } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  "select pg_get_functiondef('public.finalize_verified_authoring(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure);"
], {
  env: postgresEnvironment,
  maxBuffer: 1_000_000
});
assert(
  !/external_authoring|external_document|execution_driver|staged_blob_receipts/i.test(finalizerOutput),
  `${environment} retained an MCP branch in finalize_verified_authoring.`
);

const { stdout: comprehensiveSchemaOutput } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  `
    select 'table:' || tablename
      from pg_tables
      where schemaname = 'public'
        and tablename in (
          'source_snapshot_resources',
          'source_snapshot_pages',
          'source_snapshot_mirror_references',
          'website_source_snapshot_staging',
          'website_source_snapshot_staging_documents',
          'site_version_source_coverage',
          'site_version_redirects'
        )
    union all
    select 'function:' || proname
      from pg_proc
      join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
      where pg_namespace.nspname = 'public'
        and proname in (
          'begin_website_source_snapshot_staging',
          'stage_website_source_snapshot_documents',
          'finalize_staged_website_source_snapshot',
          'begin_incremental_website_source_snapshot',
          'complete_incremental_website_source_snapshot',
          'retain_website_source_snapshot_reference',
          'find_reusable_website_source_snapshot',
          'require_ready_public_build_input_source',
          'search_source_snapshot_pages',
          'apply_prepared_source_recapture',
          'bind_site_version_source_migration'
        )
    order by 1;
  `
], {
  env: postgresEnvironment,
  maxBuffer: 1_000_000
});
assert.deepEqual(
  comprehensiveSchemaOutput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
  [
    "function:apply_prepared_source_recapture",
    "function:begin_incremental_website_source_snapshot",
    "function:bind_site_version_source_migration",
    "function:complete_incremental_website_source_snapshot",
    "function:find_reusable_website_source_snapshot",
    "function:require_ready_public_build_input_source",
    "function:retain_website_source_snapshot_reference",
    "function:search_source_snapshot_pages",
    "table:site_version_redirects",
    "table:site_version_source_coverage",
    "table:source_snapshot_mirror_references",
    "table:source_snapshot_pages",
    "table:source_snapshot_resources"
  ],
  `${environment} is missing comprehensive source-ingestion schema.`
);

const { stdout: sourceSnapshotPersistenceOutput } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  `select
    pg_get_functiondef('public.begin_incremental_website_source_snapshot(jsonb,integer,integer)'::regprocedure)
    || pg_get_functiondef('public.complete_incremental_website_source_snapshot(text,integer,integer)'::regprocedure);`
], {
  env: postgresEnvironment,
  maxBuffer: 1_000_000
});
assert(
  sourceSnapshotPersistenceOutput.includes("ready_at")
    && sourceSnapshotPersistenceOutput.includes("source_snapshot_resources")
    && sourceSnapshotPersistenceOutput.includes("source_snapshot_pages")
    && sourceSnapshotPersistenceOutput.includes("website_source_snapshot_manifest_incomplete"),
  `${environment} website source-mirror persistence is not using bounded incremental writes and a ready-only completion gate.`
);

const { stdout: sharedSourceMirrorOutput } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  `select
    pg_get_functiondef('public.retain_website_source_snapshot_reference(jsonb,text)'::regprocedure)
    || pg_get_functiondef('public.search_source_snapshot_pages(text,text[],jsonb,integer)'::regprocedure);`
], {
  env: postgresEnvironment,
  maxBuffer: 1_000_000
});
assert(
  sharedSourceMirrorOutput.includes("source_snapshot_mirror_references")
    && sharedSourceMirrorOutput.includes("retained_source_snapshot_id")
    && sharedSourceMirrorOutput.includes("retained_website_source_snapshot_mismatch"),
  `${environment} website source mirrors are not shared through immutable business-scoped references.`
);

const { stdout: obsoleteSourceSchemaOutput } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  `
    select 'table:' || tablename
      from pg_tables
      where schemaname = 'public'
        and tablename in ('source_snapshot_objects', 'source_snapshot_chunks')
    union all
    select 'extension:' || extname
      from pg_extension
      where extname = 'vector'
    order by 1;
  `
], {
  env: postgresEnvironment,
  maxBuffer: 1_000_000
});
assert.deepEqual(
  obsoleteSourceSchemaOutput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
  [],
  `${environment} retained obsolete source-object, chunk, or pgvector schema.`
);

const { stdout: sandboxSchemaOutput } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  `
    select 'table:' || tablename
      from pg_tables
      where schemaname = 'public'
        and tablename in ('site_sandbox_deployments','site_sandbox_control','site_agent_workspace_checkpoints')
    union all
    select 'function:' || proname
      from pg_proc
      join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
      where pg_namespace.nspname = 'public'
        and proname in ('claim_site_agent_run','pause_site_agent_run_for_input','fence_expired_site_agent_session','cancel_site_agent_run','requeue_interrupted_site_agent_run','save_site_agent_session_for_execution','apply_managed_form_authoring_change')
    order by 1;
  `
], {
  env: postgresEnvironment,
  maxBuffer: 1_000_000
});
assert.deepEqual(
  sandboxSchemaOutput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
  [
    "function:apply_managed_form_authoring_change",
    "function:cancel_site_agent_run",
    "function:claim_site_agent_run",
    "function:fence_expired_site_agent_session",
    "function:pause_site_agent_run_for_input",
    "function:requeue_interrupted_site_agent_run",
    "function:save_site_agent_session_for_execution",
    "table:site_agent_workspace_checkpoints",
    "table:site_sandbox_control",
    "table:site_sandbox_deployments"
  ],
  `${environment} is missing blue-green sandbox or durable checkpoint schema.`
);

const { stdout: obsoleteAuthoringOutput } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  `
    select 'table:' || tablename
      from pg_tables
      where schemaname = 'public' and tablename = 'vertical_demand_events'
    union all
    select 'column:' || column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'site_public_build_inputs'
        and column_name in ('domain_context_id', 'domain_context_version')
    union all
    select 'function:' || oid::regprocedure::text
      from pg_proc
      where pronamespace = 'public'::regnamespace
        and prokind = 'f'
        and (pg_get_functiondef(oid) like '%domain_context%'
          or pg_get_functiondef(oid) like '%domainContext%')
    order by 1;
  `
], {
  env: postgresEnvironment,
  maxBuffer: 1_000_000
});
assert.deepEqual(
  obsoleteAuthoringOutput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
  [],
  `${environment} retained obsolete domain/vertical authoring state.`
);

const { stdout: sourceResourceConstraintOutput } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  "select string_agg(pg_get_constraintdef(oid), E'\\n') from pg_constraint where conrelid = 'public.source_snapshot_resources'::regclass;"
], {
  env: postgresEnvironment,
  maxBuffer: 1_000_000
});
assert.match(
  sourceResourceConstraintOutput,
  /http_response.*rendered_dom[\s\S]*robots.*sitemap.*document.*stylesheet.*image.*font/,
  `${environment} does not enforce the replayable source-resource contract.`
);

process.env.LODESTA_VERIFY_LIVE_DATABASE = "true";
await import("./verify-supabase");

const digest = createHash("sha256");
for (const file of migrationFiles) {
  const source = await readFile(`${migrationDirectory}/${file}`);
  digest.update(file);
  digest.update("\0");
  digest.update(source);
  digest.update("\0");
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  ok: true,
  environment,
  checkedAt: new Date().toISOString(),
  migrations: migrationFiles,
  migrationSetHash: `sha256:${digest.digest("hex")}`,
  liveDatabaseVerified: true
})}\n`);
