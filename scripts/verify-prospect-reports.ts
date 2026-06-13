import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ProspectReportRecord, ProspectWebsiteKind } from "../lib/models";
import {
  bucketForStandardCriterion,
  classifyProspectWebsite,
  prospectReportContainsForbiddenGoogleData,
  publicProspectReport,
  runProspectPresenceReport,
  unmappedStandardCriteria,
  withProspectScanSlot
} from "../lib/prospect-reports";
import { standardCriteria } from "../lib/standard";

type CheckResult = {
  name: string;
  ok: true;
  detail: string;
};

const checks: CheckResult[] = [];
const now = new Date().toISOString();

function record(name: string, detail: string, fn: () => void) {
  fn();
  checks.push({ name, ok: true, detail });
}

async function recordAsync(name: string, detail: string, fn: () => Promise<void>) {
  await fn();
  checks.push({ name, ok: true, detail });
}

function makeReport(input: {
  websiteKind: ProspectWebsiteKind;
  sourceUrl?: string;
  sourceHost?: string;
  result?: ProspectReportRecord["result"];
  unlockedAt?: string;
}): ProspectReportRecord {
  return {
    id: "prospect_report_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    placeId: "places/test-business",
    status: input.result ? "completed" : "queued",
    websiteKind: input.websiteKind,
    sourceUrl: input.sourceUrl,
    sourceHost: input.sourceHost,
    result: input.result,
    unlockedAt: input.unlockedAt,
    createdAt: now,
    updatedAt: now,
    completedAt: input.result ? now : undefined
  };
}

async function main() {
  record("criterion_mapping", "Every Standard criterion maps to one public report bucket.", () => {
    assert.deepEqual(unmappedStandardCriteria(), []);
    assert.equal(new Set(standardCriteria.map((criterion) => criterion.id)).size, standardCriteria.length);
    for (const criterion of standardCriteria) {
      assert.ok(bucketForStandardCriterion(criterion), `${criterion.id} is missing a prospect report bucket.`);
    }
    assert.equal(bucketForStandardCriterion({ id: "accessibility.image_alt" }), "trust_mobile_readiness");
    assert.equal(bucketForStandardCriterion({ id: "conversion.primary_action_above_fold" }), "website_conversion");
    assert.equal(bucketForStandardCriterion({ id: "content.auto_body.before_after" }), "local_content_coverage");
  });

  record("website_classification", "Owned, missing, social, and aggregator URLs route to the expected variant.", () => {
    assert.equal(classifyProspectWebsite(undefined).kind, "no_website");
    assert.equal(classifyProspectWebsite("https://www.facebook.com/oakhillbodyworks").kind, "social_or_aggregator");
    assert.equal(classifyProspectWebsite("https://linktr.ee/example-business").kind, "social_or_aggregator");
    assert.equal(classifyProspectWebsite("https://www.yelp.com/biz/example").kind, "social_or_aggregator");
    assert.equal(classifyProspectWebsite("lodesta.com").kind, "owned_website");
  });

  const noWebsiteResult = await runProspectPresenceReport(makeReport({ websiteKind: "no_website" }));
  record("no_owned_website_report", "Missing websites get a fixed score and first-class report result.", () => {
    assert.equal(noWebsiteResult.overallScore, 20);
    assert.equal(noWebsiteResult.overallLabel, "No owned website detected");
    assert.equal(noWebsiteResult.scoreSource, "no_owned_website");
    assert.equal(noWebsiteResult.findings[0]?.id, "no_owned_website");
  });

  const socialResult = await runProspectPresenceReport(
    makeReport({
      websiteKind: "social_or_aggregator",
      sourceHost: "facebook.com"
    })
  );
  record("social_url_report", "Social/profile URLs use the no-owned-website path instead of crawling.", () => {
    assert.equal(socialResult.scoreSource, "no_owned_website");
    assert.equal(socialResult.sourceHost, "facebook.com");
    assert.equal(socialResult.stages.find((stage) => stage.id === "crawl")?.status, "skipped");
  });

  record("low_signal_bucket", "Buckets with fewer than two scored signals do not display a numeric sub-score.", () => {
    const searchBucket = noWebsiteResult.buckets.find((bucket) => bucket.id === "search_visibility");
    assert.ok(searchBucket);
    assert.equal(searchBucket.scoredSignals, 1);
    assert.equal(searchBucket.status, "not_enough_signal");
    assert.equal(searchBucket.score, undefined);
  });

  record("gated_response_shape", "Gated plan is removed from public responses until a lead unlock is stored.", () => {
    const locked = publicProspectReport(makeReport({ websiteKind: "no_website", result: noWebsiteResult }));
    assert.equal(locked.unlocked, false);
    assert.equal(locked.result?.gatedPlan, undefined);
    const unlocked = publicProspectReport(
      makeReport({ websiteKind: "no_website", result: noWebsiteResult, unlockedAt: now })
    );
    assert.equal(unlocked.unlocked, true);
    assert.ok(unlocked.result?.gatedPlan);
  });

  await recordAsync("scan_concurrency_guard", "Nested scans are rejected when the process scan limit is reached.", async () => {
    const previous = process.env.LODESTA_PROSPECT_REPORT_SCAN_CONCURRENCY;
    process.env.LODESTA_PROSPECT_REPORT_SCAN_CONCURRENCY = "1";
    let blocked = false;
    await withProspectScanSlot(async () => {
      try {
        await withProspectScanSlot(async () => undefined);
      } catch {
        blocked = true;
      }
    });
    if (previous === undefined) {
      delete process.env.LODESTA_PROSPECT_REPORT_SCAN_CONCURRENCY;
    } else {
      process.env.LODESTA_PROSPECT_REPORT_SCAN_CONCURRENCY = previous;
    }
    assert.equal(blocked, true);
  });

  record("google_field_masks", "Places requests only ask for allowed place-id and business URL/location fields.", () => {
    const source = readFileSync(new URL("../lib/prospect-reports.ts", import.meta.url), "utf8");
    const masks = [...source.matchAll(/"X-Goog-FieldMask":\s*"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(masks, [
      "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
      "id,websiteUri,formattedAddress,addressComponents,businessStatus,types"
    ]);
    for (const mask of masks) {
      const normalized = mask.toLowerCase();
      for (const forbidden of ["rating", "userratingcount", "review", "photo", "googlemapsuri"]) {
        assert.equal(normalized.includes(forbidden), false, `${mask} includes forbidden Google field ${forbidden}.`);
      }
    }
  });

  record("google_policy_payload", "Stored report JSON does not contain forbidden Google ratings, reviews, photos, or Maps URLs.", () => {
    assert.equal(prospectReportContainsForbiddenGoogleData(noWebsiteResult), false);
    assert.equal(prospectReportContainsForbiddenGoogleData(socialResult), false);
    assert.equal(prospectReportContainsForbiddenGoogleData({ fields: { rating: 4.8 } }), true);
    assert.equal(prospectReportContainsForbiddenGoogleData({ googleMapsUri: "https://maps.google.com/example" }), true);
  });

  process.stdout.write(`${JSON.stringify({ ok: true, checks }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
