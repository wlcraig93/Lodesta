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

const databaseUrlValue = process.env.LODESTA_CUTOVER_DATABASE_URL?.trim();
assert(databaseUrlValue, "LODESTA_CUTOVER_DATABASE_URL is required for migration-ledger verification.");
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

const { stdout } = await execute("psql", [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  "select version from supabase_migrations.schema_migrations order by version;"
], {
  env: {
    ...process.env,
    PGHOST: databaseUrl.hostname,
    PGPORT: databaseUrl.port || "5432",
    PGDATABASE: decodeURIComponent(databaseUrl.pathname.replace(/^\//, "")),
    PGUSER: decodeURIComponent(databaseUrl.username),
    PGPASSWORD: decodeURIComponent(databaseUrl.password),
    PGSSLMODE: databaseUrl.searchParams.get("sslmode") || "require"
  },
  maxBuffer: 1_000_000
});
const remoteVersions = stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
assert.deepEqual(
  remoteVersions,
  localVersions,
  `${environment} migration ledger differs from the reviewed repository sequence.`
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
