import "./load-env";

import { runMarketBenchmark, type MarketBenchmarkMode } from "../lib/market-benchmark";

const args = process.argv.slice(2);

const mode = parseMode(args);
const csvPath = valueAfter("--csv");
const limit = numberAfter("--limit");
const runId = valueAfter("--run-id");
const artifactRoot = valueAfter("--artifact-root");
const fixtureRoot = valueAfter("--fixture-root");
const render = !args.includes("--no-render");
const screenshots = !args.includes("--no-screenshots");

const result = await runMarketBenchmark({
  mode,
  csvPath,
  limit,
  runId,
  artifactRoot,
  fixtureRoot,
  render,
  screenshots
});

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      runId: result.runId,
      artifactRoot: result.artifactRoot,
      reportPath: result.reportPath,
      accepted: result.candidates.accepted.length,
      rejected: result.candidates.rejected.length,
      needsReview: result.candidates.needsReview.length,
      scored: result.siteResults.length
    },
    null,
    2
  )}\n`
);

function parseMode(values: string[]): MarketBenchmarkMode {
  if (values.includes("--fixture")) return "fixture";
  if (values.includes("--csv")) return "csv";
  return "google_places";
}

function valueAfter(flag: string) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function numberAfter(flag: string) {
  const value = valueAfter(flag);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
