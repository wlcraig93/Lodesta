import "./load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sitePlatformRepository } from "../packages/platform-data";
import { configuredSiteSandboxClientForDeployment } from "../packages/site-sandbox";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const deploymentId = process.argv.find((value) => value.startsWith("--deployment-id="))?.slice("--deployment-id=".length);
if (!deploymentId) throw new Error("Use --deployment-id=<pinned-sandbox-deployment-id>; this benchmark never follows a mutable live selector.");
const deployment = await sitePlatformRepository.getSandboxDeployment(deploymentId);
if (!deployment) throw new Error(`Pinned sandbox deployment ${deploymentId} does not exist.`);
const sandbox = configuredSiteSandboxClientForDeployment(deployment);
const buildInput = buildSyntheticSiteInput("site-runtime-v4");
const samples: Array<{
  kind: "cold" | "warm";
  replicate: number;
  elapsedMs: number;
  phaseTimings: Record<string, number>;
  operationId: string;
  submissionAttempts: number;
  submissionLatencyMs: number;
  submissionPayloadBytes: number;
  submissionRecoveryCause?: string;
}> = [];

for (let replicate = 1; replicate <= 10; replicate += 1) {
  const sessionId = id(`v4_cold_${replicate}`);
  try {
    const bootstrapped = await sandbox.bootstrap(sessionId, buildInput);
    const startedAt = Date.now();
    const result = await sandbox.apply(sessionId, bootstrapped.revision, kindSizedFixture("cold", replicate));
    record("cold", replicate, startedAt, result);
  } finally {
    await sandbox.destroy(sessionId).catch(() => undefined);
  }
}

const warmSessionId = id("v4_warm");
let warmRevision = (await sandbox.bootstrap(warmSessionId, buildInput)).revision;
try {
  for (let replicate = 1; replicate <= 10; replicate += 1) {
    const startedAt = Date.now();
    const result = await sandbox.apply(warmSessionId, warmRevision, kindSizedFixture("warm", replicate));
    record("warm", replicate, startedAt, result);
    warmRevision = result.revision;
  }
} finally {
  await sandbox.destroy(warmSessionId).catch(() => undefined);
}

assert.equal(samples.length, 20);
assert(samples.every((sample) => sample.submissionAttempts === 1 && !sample.submissionRecoveryCause), "A cold/warm benchmark submission required transport replay or recycle.");

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  deploymentId,
  workerVersionId: deployment.workerVersionId,
  imageDigest: deployment.imageDigest,
  samples,
  summaries: Object.fromEntries((["cold", "warm"] as const).map((kind) => {
    const selected = samples.filter((sample) => sample.kind === kind);
    return [kind, {
      count: selected.length,
      p50Ms: percentile(selected.map((sample) => sample.elapsedMs), 0.5),
      p95Ms: percentile(selected.map((sample) => sample.elapsedMs), 0.95),
      maxSubmissionPayloadBytes: Math.max(...selected.map((sample) => sample.submissionPayloadBytes)),
      recoveryCount: selected.filter((sample) => sample.submissionAttempts > 1 || sample.submissionRecoveryCause).length
    }];
  }))
}, null, 2)}\n`);

function record(kind: "cold" | "warm", replicate: number, startedAt: number, result: Awaited<ReturnType<typeof sandbox.apply>>) {
  samples.push({
    kind,
    replicate,
    elapsedMs: Date.now() - startedAt,
    phaseTimings: result.phaseTimings,
    operationId: result.operationId,
    submissionAttempts: requireNumber(result.submissionAttempts, "submissionAttempts"),
    submissionLatencyMs: requireNumber(result.submissionLatencyMs, "submissionLatencyMs"),
    submissionPayloadBytes: requireNumber(result.submissionPayloadBytes, "submissionPayloadBytes"),
    ...(result.submissionRecoveryCause ? { submissionRecoveryCause: result.submissionRecoveryCause } : {})
  });
}

function kindSizedFixture(kind: "cold" | "warm", replicate: number) {
  const routes = Array.from({ length: 28 }, (_, index) => `{path:${JSON.stringify(index ? `/service-${index}` : "/")},title:${JSON.stringify(index ? `Service ${index}` : "Home")},description:"Source-grounded local service route",element:<main><h1>${index ? `Service ${index}` : "Local service"}</h1><p>${"Retained source-grounded business content. ".repeat(180)}</p></main>}`).join(",");
  const marker = `${kind}-${replicate}`;
  return [
    { path: "src/site.tsx", content: `export const siteDefinition={routes:[${routes}]}; // ${marker}` },
    { path: "src/styles.css", content: `:root{--site-color-primary:#173c33;--site-color-surface:#fff;--site-color-text:#15201d}main{display:block;max-width:70rem;margin:auto;padding:2rem}/* ${marker} */` }
  ];
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function id(label: string) {
  return `latency_${label}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function requireNumber(value: number | undefined, field: string) {
  if (typeof value !== "number") throw new Error(`Pinned sandbox response omitted ${field}.`);
  return value;
}
