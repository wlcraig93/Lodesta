import "./load-env";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256, stableJson } from "../packages/business-data";
import {
  agentRunEventsLifecycleRule,
  assertAgentRunEventsLifecyclePolicy,
  assertNoAgentRunEventsLifecycleConflict,
  listR2LifecycleRules,
  runWranglerLifecycle,
  type R2LifecycleRule
} from "./r2-lifecycle-policy";

const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length);
if (!apply && confirmation) throw new Error("--confirm requires --apply.");

const bucket = process.env.LODESTA_ARTIFACT_BUCKET ?? "lodesta-agentic-sites-v1";
const desiredRules = [agentRunEventsLifecycleRule] as const;
const reportPath = resolve(process.cwd(), ".data/maintenance/r2-lifecycle-audit.json");

const current = await listLifecycleRules();
assertNoConflictingRules(current);
const payload = {
  schemaVersion: "r2-lifecycle-audit-v1",
  bucket,
  current,
  requestedOperations: requestedOperations(current),
  desiredRules
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
    requestedOperations: payload.requestedOperations,
    desiredRules
  })}\n`);
} else {
  const expected = `set-r2-lifecycle:${reportHash}`;
  if (confirmation !== expected) throw new Error(`Pass --confirm=${expected} to apply this exact lifecycle configuration.`);

  const refreshed = await listLifecycleRules();
  const refreshedPayload = {
    ...payload,
    current: refreshed,
    requestedOperations: requestedOperations(refreshed)
  };
  const refreshedHash = sha256(stableJson(refreshedPayload));
  if (refreshedHash !== reportHash) {
    throw new Error(`R2 lifecycle configuration changed after the report was written; rerun the dry-run (new hash ${refreshedHash}).`);
  }

  for (const operation of payload.requestedOperations) {
    if (operation.operation !== "add") continue;
    const rule = desiredRules.find((candidate) => candidate.name === operation.name)!;
    await runWranglerLifecycle([
      "r2", "bucket", "lifecycle", "add", bucket, rule.name, rule.prefix,
      "--expire-days", String(rule.days), "--force"
    ]);
  }
  const verified = await listLifecycleRules();
  assertDesiredRules(verified);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: payload.requestedOperations.some((operation) => operation.operation === "add") ? "apply" : "no-op",
    reportPath,
    reportHash,
    desiredRules
  })}\n`);
}

async function listLifecycleRules() { return listR2LifecycleRules(bucket); }

function requestedOperations(rules: R2LifecycleRule[]) {
  return desiredRules.map((rule) => ({
    name: rule.name,
    operation: rules.some((candidate) => candidate.name === rule.name) ? "no-op" as const : "add" as const
  }));
}

function assertNoConflictingRules(rules: R2LifecycleRule[]) {
  assertNoAgentRunEventsLifecycleConflict(rules);
}

function assertDesiredRules(rules: R2LifecycleRule[]) {
  assertAgentRunEventsLifecyclePolicy(rules);
}
