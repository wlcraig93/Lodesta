/**
 * Benchmark vector cadence (next-level plan, measurement loop).
 *
 * Regenerates the benchmark shop set through the live pipeline and reports
 * the full scorecard vector per shop plus fleet-health aggregates
 * (per-dimension P50/P10 and same-vertical fingerprint distance). Run after
 * every catalog batch; the trajectory of this output is the product's
 * honest progress meter.
 *
 *   npm run benchmark:vector            # default Austin auto set
 *   npm run benchmark:vector -- <url..> # explicit targets
 *
 * Requires .env.local (OpenAI + Supabase + Places). Costs real LLM calls.
 */
import { generateSite } from "../lib/site-candidate-service";
import { repository } from "../lib/repository";
import { computeFingerprintV1, minPairwiseDistanceV1, fingerprintDistanceThresholdV1, type SiteFingerprintV1 } from "../lib/fingerprint-v1";
import type { ScorecardDimensionId } from "../lib/models";

const defaultTargets = [
  "http://www.texastires30.com/",
  "https://www.lambstire.com/locations/tx/austin/auto-repair-5405-n-lamar"
];

function percentile(values: number[], fraction: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

async function main() {
  const targets = process.argv.slice(2).filter((arg) => arg.startsWith("http"));
  const urls = targets.length ? targets : defaultTargets;
  const vectors: Array<Record<string, number>> = [];
  const fingerprints: SiteFingerprintV1[] = [];

  for (const url of urls) {
    try {
      const result = await generateSite({
        repository,
        input: { url },
        source: "api",
        actorType: "operator",
        metadata: { reason: "benchmark vector cadence" }
      });
      const version = result.bundle.siteModel.versions[0];
      const qa = version?.generationQa;
      const vector: Record<string, number> = {};
      for (const dimension of qa?.scorecard?.dimensions ?? []) {
        if (typeof dimension.score === "number") vector[dimension.id] = dimension.score;
      }
      vectors.push(vector);
      if (version) fingerprints.push(computeFingerprintV1(version));
      console.log(
        JSON.stringify({
          url,
          status: result.generation.status,
          verdict: qa?.scorecard?.verdict,
          vector,
          coverage: qa?.factCoverage ? `${qa.factCoverage.surfacedCount}/${qa.factCoverage.eligibleCount}` : undefined,
          blockers: (qa?.blockers ?? []).map((blocker) => blocker.id)
        })
      );
    } catch (error) {
      console.log(JSON.stringify({ url, error: error instanceof Error ? error.message.slice(0, 120) : String(error) }));
    }
  }

  const dimensionIds: ScorecardDimensionId[] = [
    "correctness_grounding",
    "visual_design",
    "mobile_experience",
    "conversion_readiness",
    "seo_structure",
    "content_quality",
    "brand_identity",
    "accessibility"
  ];
  const fleet: Record<string, { p50?: number; p10?: number; scored: number }> = {};
  for (const id of dimensionIds) {
    const values = vectors.map((vector) => vector[id]).filter((value): value is number => typeof value === "number");
    fleet[id] = { p50: percentile(values, 0.5), p10: percentile(values, 0.1), scored: values.length };
  }
  const minDistance = minPairwiseDistanceV1(fingerprints);
  console.log(
    JSON.stringify({
      fleet,
      fingerprint: {
        minPairwiseDistance: minDistance,
        threshold: fingerprintDistanceThresholdV1,
        healthy: minDistance === undefined || minDistance >= fingerprintDistanceThresholdV1
      }
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
