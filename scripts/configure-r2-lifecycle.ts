import "./load-env";
import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { sha256, stableJson } from "../packages/business-data";

const execFileAsync = promisify(execFile);
const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length);
if (!apply && confirmation) throw new Error("--confirm requires --apply.");

const bucket = process.env.LODESTA_ARTIFACT_BUCKET ?? "lodesta-agentic-sites-v1";
const rule = {
  name: "lodesta-expire-trace-payloads-v1",
  enabled: true,
  prefix: "trace-payloads/",
  action: "expire",
  days: 1
} as const;
const reportPath = resolve(process.cwd(), ".data/maintenance/r2-lifecycle-audit.json");

const current = await listLifecycleRules();
assertNoConflictingRule(current);
const payload = {
  schemaVersion: "r2-lifecycle-audit-v1",
  bucket,
  current,
  requestedOperation: current.some((candidate) => candidate.name === rule.name) ? "no-op" : "add",
  desiredRule: rule
};
const reportHash = sha256(stableJson(payload));
const report = { ...payload, createdAt: new Date().toISOString(), reportHash };
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (!apply) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: "dry-run",
    reportPath,
    reportHash,
    confirmation: `set-r2-lifecycle:${reportHash}`,
    requestedOperation: payload.requestedOperation,
    desiredRule: rule
  })}\n`);
} else {
  const expected = `set-r2-lifecycle:${reportHash}`;
  if (confirmation !== expected) throw new Error(`Pass --confirm=${expected} to apply this exact lifecycle configuration.`);

  const refreshed = await listLifecycleRules();
  const refreshedPayload = {
    ...payload,
    current: refreshed,
    requestedOperation: refreshed.some((candidate) => candidate.name === rule.name) ? "no-op" : "add"
  };
  const refreshedHash = sha256(stableJson(refreshedPayload));
  if (refreshedHash !== reportHash) {
    throw new Error(`R2 lifecycle configuration changed after the report was written; rerun the dry-run (new hash ${refreshedHash}).`);
  }

  if (payload.requestedOperation === "add") {
    await runWrangler([
      "r2", "bucket", "lifecycle", "add", bucket, rule.name, rule.prefix,
      "--expire-days", String(rule.days), "--force"
    ]);
  }
  const verified = await listLifecycleRules();
  assertDesiredRule(verified);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: payload.requestedOperation === "add" ? "apply" : "no-op",
    reportPath,
    reportHash,
    desiredRule: rule
  })}\n`);
}

type ListedRule = {
  name: string;
  enabled: boolean;
  prefix: string;
  action: string;
};

async function listLifecycleRules(): Promise<ListedRule[]> {
  const output = await runWrangler(["r2", "bucket", "lifecycle", "list", bucket]);
  const plain = output
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const lines = plain.split("\n").map((line) => line.trim());
  const rules: ListedRule[] = [];
  let fields = new Map<string, string>();
  const flush = () => {
    if (!fields.size) return;
    const name = fields.get("name");
    const enabled = fields.get("enabled");
    const prefix = fields.get("prefix");
    const action = fields.get("action");
    if (!name || !enabled || prefix === undefined || !action) {
      throw new Error(`Wrangler returned an unrecognized lifecycle rule: ${JSON.stringify(Object.fromEntries(fields))}`);
    }
    rules.push({ name, enabled: enabled.toLowerCase() === "yes", prefix, action });
    fields = new Map<string, string>();
  };
  for (const line of lines) {
    const match = line.match(/^([a-z]+):\s*(.*?)\s*$/i);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    if (key === "name" && fields.size) flush();
    if (["name", "enabled", "prefix", "action"].includes(key)) fields.set(key, match[2]!);
  }
  flush();
  return rules.sort((left, right) => left.name.localeCompare(right.name));
}

function assertNoConflictingRule(rules: ListedRule[]) {
  if (rules.some((candidate) => candidate.name === rule.name)) assertDesiredRule(rules);
}

function assertDesiredRule(rules: ListedRule[]) {
  const existing = rules.find((candidate) => candidate.name === rule.name);
  if (!existing || !existing.enabled || existing.prefix !== rule.prefix
    || !/expire objects after 1 day/i.test(existing.action)) {
    throw new Error(`Lifecycle rule ${rule.name} is absent or differs from the required one-day trace-payload policy.`);
  }
}

async function runWrangler(args: string[]) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  if (process.platform === "win32") {
    const result = await execFileAsync(command, ["wrangler", ...args], { maxBuffer: 1024 * 1024 });
    return result.stdout;
  }
  // Wrangler only unlocks its stored OAuth session when it has a terminal. `script`
  // supplies a short-lived pseudo-terminal while still letting us capture and verify output.
  return await new Promise<string>((resolveRun, rejectRun) => {
    const child = spawn("script", ["-q", "/dev/null", command, "wrangler", ...args], {
      stdio: ["inherit", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    const collect = (target: Buffer[], chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > 1024 * 1024) {
        child.kill();
        rejectRun(new Error("Wrangler lifecycle output exceeded one MiB."));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", rejectRun);
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8");
      if (code === 0) resolveRun(output);
      else rejectRun(new Error(`Wrangler lifecycle command failed (${code ?? "signal"}): ${Buffer.concat(stderr).toString("utf8") || output}`));
    });
  });
}
