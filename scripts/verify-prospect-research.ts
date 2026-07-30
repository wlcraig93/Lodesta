import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalPlatformOperationsRepository } from "../packages/platform-operations";
import {
  canonicalProspectKey,
  prospectWebsiteKindForUrl,
  scoreProspectPriority
} from "../packages/prospect-research";

const directory = await mkdtemp(join(tmpdir(), "lodesta-prospect-research-"));
const repository = new LocalPlatformOperationsRepository(join(directory, "operations.json"));

try {
  assert.equal(
    canonicalProspectKey({
      websiteUrl: "https://www.example.com/services/?campaign=test",
      businessName: "Example"
    }),
    "website:example.com"
  );
  assert.equal(
    canonicalProspectKey({
      websiteUrl: "https://www.facebook.com/example-plumbing/",
      businessName: "Example Plumbing"
    }),
    "website:facebook.com/example-plumbing"
  );
  assert.equal(prospectWebsiteKindForUrl("https://www.facebook.com/example-plumbing/"), "social_or_aggregator");
  assert.equal(prospectWebsiteKindForUrl("https://example.com/"), "owned_website");

  const prospect = await repository.upsertProspect({
    canonicalKey: "website:example.com",
    businessName: "Example Plumbing",
    vertical: "plumbing",
    industryCode: "plumbing",
    status: "active",
    websiteKind: "owned_website",
    websiteUrl: "https://www.example.com/",
    locality: "Georgetown",
    region: "tx",
    countryCode: "us",
    phone: "512-555-0100",
    doNotContact: false
  });
  assert.equal(prospect.websiteHost, "example.com");
  assert.equal(prospect.region, "TX");
  assert.equal(prospect.countryCode, "US");

  const scoring = scoreProspectPriority({
    reviewRating: 4.8,
    reviewCount: 180,
    yearsInBusiness: 12,
    websiteOpportunityScore: 78,
    hasBusinessPhone: true,
    hasPublicBusinessEmail: true,
    evidenceCoverage: 0.8
  });
  const observation = await repository.createProspectObservation({
    prospectId: prospect.id,
    sourceType: "public_listing",
    sourceUrl: "https://data.example.test/business/example",
    observedAt: "2026-07-29T12:00:00.000Z",
    websiteKind: "owned_website",
    websiteUrl: "https://www.example.com/",
    reviewRating: 4.8,
    reviewCount: 180,
    yearsInBusiness: 12,
    cms: "WordPress",
    agencyStatus: "not_observed",
    websiteOpportunityScore: 78,
    reachabilityScore: scoring.reachability,
    priorityScore: scoring.priority,
    scoringModel: scoring.model,
    verificationStatus: "verified",
    verificationScore: 96,
    operatingStatus: "operational",
    targetFitStatus: "target",
    evidenceCoverage: 0.8,
    producer: "verify-prospect-research",
    methodologyIdentity: "verify-prospect-research",
    inputHash: "sha256:example-observation"
  });
  const repeatedObservation = await repository.createProspectObservation({
    ...observation,
    sourceType: observation.sourceType,
    inputHash: observation.inputHash
  });
  assert.equal(repeatedObservation.id, observation.id);
  assert.equal(observation.verificationStatus, "verified");
  assert.equal(observation.targetFitStatus, "target");

  await assert.rejects(
    () => repository.upsertProspectContact({
      prospectId: prospect.id,
      contactType: "owner",
      email: "guessed@example.com",
      sourceType: "import",
      verificationStatus: "unverified",
      outreachEligible: true,
      observedAt: "2026-07-29T12:00:00.000Z"
    }),
    /Unverified contact data/
  );
  const businessContact = await repository.upsertProspectContact({
    prospectId: prospect.id,
    contactType: "business_general",
    email: "hello@example.com",
    phone: "512-555-0100",
    sourceType: "business_website",
    sourceUrl: "https://www.example.com/contact",
    verificationStatus: "public_source",
    outreachEligible: true,
    observedAt: "2026-07-29T12:00:00.000Z"
  });
  const refreshedBusinessContact = await repository.upsertProspectContact({
    prospectId: prospect.id,
    contactType: "business_general",
    fullName: "Office Team",
    email: "HELLO@example.com",
    phone: "512-555-0199",
    sourceType: "business_website",
    sourceUrl: "https://www.example.com/contact",
    verificationStatus: "public_source",
    outreachEligible: true,
    observedAt: "2026-07-29T13:00:00.000Z"
  });
  assert.equal(refreshedBusinessContact.id, businessContact.id);
  assert.equal((await repository.listProspectContacts(prospect.id)).length, 1);

  const noWebsite = await repository.upsertProspect({
    canonicalKey: "business:sample landscaping:casper:wy",
    businessName: "Sample Landscaping",
    vertical: "landscaping_tree",
    industryCode: "landscaping_tree",
    status: "active",
    websiteKind: "no_website",
    locality: "Casper",
    region: "WY",
    countryCode: "US",
    doNotContact: false
  });
  const noWebsiteObservation = await repository.createProspectObservation({
    prospectId: noWebsite.id,
    sourceType: "licensed_dataset",
    observedAt: "2026-07-29T11:00:00.000Z",
    websiteKind: "no_website",
    agencyStatus: "not_observed",
    websiteOpportunityScore: 100,
    priorityScore: 30,
    scoringModel: scoring.model,
    evidenceCoverage: 0.5,
    producer: "verify-prospect-research",
    methodologyIdentity: "verify-prospect-research",
    inputHash: "sha256:no-website-observation"
  });

  const candidates = await repository.listProspectCandidates({ minimumPriorityScore: 20 });
  assert.deepEqual(candidates.map((candidate) => candidate.businessName), ["Example Plumbing", "Sample Landscaping"]);
  assert.equal(await repository.countProspectCandidates({ minimumPriorityScore: 20 }), 2);
  assert.deepEqual(
    (await repository.listProspectCandidates({
      minimumPriorityScore: 20,
      sortBy: "business_name",
      sortDirection: "desc",
      offset: 1,
      limit: 1
    })).map((candidate) => candidate.businessName),
    ["Example Plumbing"]
  );
  assert.equal(candidates[0]?.publicEmail, "hello@example.com");
  assert.equal((await repository.listProspectCandidates({ region: "WY" }))[0]?.websiteKind, "no_website");
  assert.equal((await repository.listProspectCandidates({ verificationStatus: "verified" }))[0]?.businessName, "Example Plumbing");
  assert.equal((await repository.listProspectCandidates({ targetFitStatus: "target" }))[0]?.verificationScore, 96);
  assert.equal((await repository.listProspectCandidates({ minimumVerificationScore: 95 })).length, 1);

  const campaign = await repository.createOutboundCampaign({ name: "Research verification" });
  const member = await repository.upsertOutboundProspect({
    prospectId: prospect.id,
    selectionObservationId: observation.id,
    campaignId: campaign.id
  });
  assert.equal(member.businessName, "Example Plumbing");
  assert.equal(member.prospectId, prospect.id);
  await assert.rejects(
    () => repository.upsertOutboundProspect({
      prospectId: prospect.id,
      selectionObservationId: noWebsiteObservation.id,
      campaignId: campaign.id
    }),
    /observation for the canonical prospect/
  );

  await assert.rejects(
    () => repository.importProspectResearch([
      {
        prospect: {
          canonicalKey: "website:duplicate.test",
          businessName: "Duplicate One",
          status: "active",
          websiteKind: "owned_website",
          websiteUrl: "https://duplicate.test/",
          countryCode: "US",
          doNotContact: false
        }
      },
      {
        prospect: {
          canonicalKey: "website:duplicate.test",
          businessName: "Duplicate Two",
          status: "active",
          websiteKind: "owned_website",
          websiteUrl: "https://duplicate.test/",
          countryCode: "US",
          doNotContact: false
        }
      }
    ]),
    /duplicate canonical keys/
  );

  await repository.upsertProspectSource({
    id: "test:TX:source-snapshot",
    vertical: "plumbing",
    jurisdiction: "TX",
    authorityName: "Verification authority",
    sourceName: "Verification source",
    sourceUrl: "https://data.example.test/source-snapshot",
    accessMethod: "json",
    coverageStatus: "complete",
    recordScope: "business"
  });
  const retainedSourceProspect = await repository.upsertProspect({
    canonicalKey: "license-holder:test:retained",
    businessName: "Retained Source Prospect",
    vertical: "plumbing",
    status: "active",
    websiteKind: "unknown",
    countryCode: "US",
    doNotContact: false,
    metadata: { acquisitionSource: "test:TX:source-snapshot" }
  });
  const staleSourceProspect = await repository.upsertProspect({
    canonicalKey: "license-holder:test:stale",
    businessName: "Stale Source Prospect",
    vertical: "plumbing",
    status: "active",
    websiteKind: "unknown",
    countryCode: "US",
    doNotContact: false,
    metadata: { acquisitionSource: "test:TX:source-snapshot" }
  });
  const pruned = await repository.pruneProspectSourceSnapshots([{
    sourceId: "test:TX:source-snapshot",
    retainedCanonicalKeys: [retainedSourceProspect.canonicalKey]
  }]);
  assert.equal(pruned.prospects, 1);
  assert.ok(await repository.getProspect(retainedSourceProspect.id));
  assert.equal(await repository.getProspect(staleSourceProspect.id), null);

  console.log(JSON.stringify({
    ok: true,
    candidates: candidates.length,
    topCandidate: candidates[0]?.businessName,
    campaignProspect: member.id
  }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
