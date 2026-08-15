import "./load-env";

import { randomUUID } from "node:crypto";
import { configuredSiteSandboxClient } from "../packages/site-sandbox";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const sandbox = configuredSiteSandboxClient();
const sessionId = `latency_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
const buildInput = buildSyntheticSiteInput();
const samples: Array<{
  kind: "no-op" | "small-edit" | "full-build";
  replicate: number;
  elapsedMs: number;
  phaseTimings: Record<string, number>;
  operationId: string;
}> = [];

let revision = (await sandbox.bootstrap(sessionId, buildInput)).revision;
try {
  for (const kind of ["no-op", "small-edit", "full-build"] as const) {
    for (let replicate = 1; replicate <= 5; replicate += 1) {
      const startedAt = Date.now();
      const result = await sandbox.apply(sessionId, revision, fixture(kind, replicate));
      samples.push({
        kind,
        replicate,
        elapsedMs: Date.now() - startedAt,
        phaseTimings: result.phaseTimings,
        operationId: result.operationId
      });
      revision = result.revision;
    }
  }
} finally {
  await sandbox.destroy(sessionId).catch(() => undefined);
}

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
};
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sessionId,
  samples,
  summaries: Object.fromEntries((["no-op", "small-edit", "full-build"] as const).map((kind) => {
    const elapsed = samples.filter((sample) => sample.kind === kind).map((sample) => sample.elapsedMs);
    return [kind, { p50Ms: percentile(elapsed, 0.5), p95Ms: percentile(elapsed, 0.95), count: elapsed.length }];
  }))
}, null, 2)}\n`);

function fixture(kind: "no-op" | "small-edit" | "full-build", replicate: number) {
  const routes = kind === "full-build"
    ? Array.from({ length: 30 }, (_, index) => `{path:${JSON.stringify(index ? `/route-${index}` : "/")},title:${JSON.stringify(`Route ${index}`)},description:"Benchmark route",element:<main><h1>Route ${index}</h1><p>${"Retained benchmark content. ".repeat(80)}</p></main>}`).join(",")
    : `{path:"/",title:"Benchmark",description:"Benchmark route",element:<main><h1>Benchmark</h1><p>Stable content</p></main>}`;
  const marker = kind === "no-op" ? "stable" : `${kind}-${replicate}`;
  return [
    { path: "src/site.tsx", content: `export const siteDefinition={routes:[${routes}]}; // ${marker}` },
    { path: "src/styles.css", content: `main{display:block;max-width:70rem;margin:auto}/* ${marker} */` }
  ];
}
