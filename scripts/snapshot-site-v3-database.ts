import "./load-env";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const runId = process.argv.find((argument) => argument.startsWith("--run-id="))?.slice("--run-id=".length);
if (!runId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(runId)) {
  throw new Error("Usage: snapshot:site-v3-database -- --run-id=<stable alphanumeric run ID>");
}
const databaseUrl = process.env.LODESTA_CUTOVER_DATABASE_URL;
if (!databaseUrl) throw new Error("LODESTA_CUTOVER_DATABASE_URL is required for the pre-cutover database snapshot.");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL is required to bind the database snapshot environment.");
const environment = new URL(supabaseUrl).hostname;
const projectRef = environment.split(".")[0];
const databaseTarget = new URL(databaseUrl);
if (!databaseTarget.hostname.includes(projectRef) && !decodeURIComponent(databaseTarget.username).includes(projectRef)) {
  throw new Error("LODESTA_CUTOVER_DATABASE_URL does not match the configured Supabase project.");
}
const outputPath = resolve(process.cwd(), `.data/cutovers/site-v3/${runId}/database.dump`);
const metadataPath = `${outputPath}.metadata.json`;
if (await stat(outputPath).then(() => true, () => false)) throw new Error(`Database snapshot already exists at ${relative(process.cwd(), outputPath)}.`);
if (await stat(metadataPath).then(() => true, () => false)) throw new Error(`Database snapshot metadata already exists at ${relative(process.cwd(), metadataPath)}.`);
await mkdir(dirname(outputPath), { recursive: true });

const pgDump = process.env.LODESTA_PG_DUMP_BIN ?? "pg_dump";
const pgEnvironment = { ...process.env };
delete pgEnvironment.LODESTA_CUTOVER_DATABASE_URL;
pgEnvironment.PGHOST = databaseTarget.hostname;
pgEnvironment.PGPORT = databaseTarget.port || "5432";
pgEnvironment.PGUSER = decodeURIComponent(databaseTarget.username);
pgEnvironment.PGPASSWORD = decodeURIComponent(databaseTarget.password);
pgEnvironment.PGDATABASE = decodeURIComponent(databaseTarget.pathname.replace(/^\//, ""));
pgEnvironment.PGSSLMODE = databaseTarget.searchParams.get("sslmode") ?? "require";
if (!pgEnvironment.PGHOST || !pgEnvironment.PGUSER || !pgEnvironment.PGPASSWORD || !pgEnvironment.PGDATABASE) {
  throw new Error("LODESTA_CUTOVER_DATABASE_URL must include host, user, password, and database name.");
}
await new Promise<void>((resolvePromise, reject) => {
  const child = spawn(pgDump, [
    "--format=custom",
    "--schema=public",
    "--no-owner",
    "--no-acl",
    `--file=${outputPath}`
  ], {
    stdio: ["ignore", "inherit", "inherit"],
    env: pgEnvironment
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => code === 0
    ? resolvePromise()
    : reject(new Error(`pg_dump failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}.`)));
});

const bytes = await readFile(outputPath);
if (bytes.subarray(0, 5).toString("ascii") !== "PGDMP") throw new Error("pg_dump did not produce a PostgreSQL custom-format archive.");
const result = {
  schemaVersion: "site-v3-database-snapshot-v1",
  ok: true,
  runId,
  environment,
  path: relative(process.cwd(), outputPath),
  bytes: bytes.length,
  hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  createdAt: new Date().toISOString()
};
await writeFile(metadataPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ ...result, metadataPath: relative(process.cwd(), metadataPath) }, null, 2)}\n`);
