import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { LocalPlatformOperationsRepository } from "../packages/platform-operations/repository";
import { evaluateProspectPlace, prospectAddressFromGoogleComponents, prospectImportSchema } from "../packages/prospect-research";

assert.deepEqual(prospectAddressFromGoogleComponents([
  { longText: "609", shortText: "609", types: ["street_number"] },
  { longText: "10th Street", shortText: "10th St", types: ["route"] },
  { longText: "Suite 4", shortText: "Ste 4", types: ["subpremise"] },
  { longText: "Port Saint Joe", shortText: "Port Saint Joe", types: ["locality"] },
  { longText: "Florida", shortText: "FL", types: ["administrative_area_level_1"] },
  { longText: "Gulf County", shortText: "Gulf County", types: ["administrative_area_level_2"] },
  { longText: "32456", shortText: "32456", types: ["postal_code"] },
  { longText: "United States", shortText: "US", types: ["country"] }
]), {
  address_line_1: "609 10th Street",
  address_line_2: "Suite 4",
  locality: "Port Saint Joe",
  region: "FL",
  postal_code: "32456",
  country_code: "US",
  county: "Gulf County"
});

assert.equal(evaluateProspectPlace({ names: ["99 Pest Solutions LLC"], region: "TX" }, {
  displayName: { text: "99 Pest Solutions, LLC" },
  primaryType: "pest_control_service",
  types: ["pest_control_service"],
  formattedAddress: "19507 Wied Rd Ste A, Spring, TX 77388, USA",
  addressComponents: [
    { longText: "Texas", shortText: "TX", types: ["administrative_area_level_1"] }
  ],
  businessStatus: "OPERATIONAL"
}).plausible, true);

assert.equal(evaluateProspectPlace({ names: ["2 Brothers Environmental Services"], region: "FL" }, {
  displayName: { text: "4642 NW 3rd Dr" },
  primaryType: "street_address",
  types: ["street_address"],
  formattedAddress: "4642 NW 3rd Dr, Delray Beach, FL 33445, USA"
}).plausible, false);

assert.equal(evaluateProspectPlace({ names: ["1up Pest Control LLC"], region: "GA" }, {
  displayName: { text: "1up Pest Control" },
  primaryType: "pest_control_service",
  types: ["pest_control_service"],
  formattedAddress: "7411 Legacy Pines Dr, Cypress, TX 77433, USA",
  addressComponents: [
    { longText: "Texas", shortText: "TX", types: ["administrative_area_level_1"] }
  ],
  businessStatus: "OPERATIONAL"
}).plausible, false);

assert.equal(evaluateProspectPlace({ names: ["410 Pest Control"], region: "TX" }, {
  displayName: { text: "4D Pest Control, LLC" },
  primaryType: "service",
  formattedAddress: "631 Blueberry Hl Rd, Somerville, TX 77879, USA",
  businessStatus: "OPERATIONAL"
}).plausible, false);

assert.equal(evaluateProspectPlace({ names: ["A J Pest Control"], region: "TX" }, {
  displayName: { text: "J&J Pest Control Inc" },
  primaryType: "service",
  formattedAddress: "2300 Pasadena Dr Ste A, Austin, TX 78757, USA",
  businessStatus: "OPERATIONAL"
}).plausible, false);

assert.equal(evaluateProspectPlace({ names: ["A + Pest Control"], region: "TX" }, {
  displayName: { text: "Alta Pest Control" },
  primaryType: "pest_control_service",
  formattedAddress: "Austin, TX 78701, USA",
  businessStatus: "OPERATIONAL"
}).plausible, false);

assert.equal(evaluateProspectPlace({ names: ["A Plus Pest Control"], region: "TX" }, {
  displayName: { text: "A-Plus Pest Control Midland" },
  primaryType: "pest_control_service",
  formattedAddress: "111 W Wall St, Midland, TX 79701, USA",
  businessStatus: "OPERATIONAL"
}).plausible, true);

assert.equal(evaluateProspectPlace({ names: ["A Plus Pest Services LLC"], region: "NY" }, {
  displayName: { text: "A + Pest Services" },
  primaryType: "pest_control_service",
  formattedAddress: "123 N Main St, New City, NY 10956, USA",
  businessStatus: "OPERATIONAL"
}).plausible, true);

assert.equal(evaluateProspectPlace({ names: ["05 Total Solutions LLC"], region: "FL" }, {
  displayName: { text: "Total Pest Solutions" },
  primaryType: "pest_control_service",
  formattedAddress: "Tampa, FL 33602, USA",
  businessStatus: "OPERATIONAL"
}).plausible, false);

assert.equal(evaluateProspectPlace({ names: ["A Aardvark Pest Control"], region: "TX" }, {
  displayName: { text: "Aardvark Pest Control Services" },
  primaryType: "pest_control_service",
  formattedAddress: "San Antonio, TX 78201, USA",
  businessStatus: "OPERATIONAL"
}).plausible, true);

assert.equal(evaluateProspectPlace({ names: ["A 1 Shot Pest Control"], region: "TX" }, {
  displayName: { text: "A-1 Pest Control Service Inc" },
  primaryType: "pest_control_service",
  formattedAddress: "Fort Worth, TX 76133, USA",
  businessStatus: "OPERATIONAL"
}).plausible, false);

assert.equal(evaluateProspectPlace({ names: ["A Bear Pest Control And Tree Service"], region: "TX" }, {
  displayName: { text: "A-Bear Pest Control" },
  primaryType: "pest_control_service",
  formattedAddress: "San Antonio, TX 78212, USA",
  businessStatus: "OPERATIONAL"
}).plausible, true);

const sameStateDifferentCounty = evaluateProspectPlace({ names: ["A And B Pest Control"], region: "TX", county: "Harris" }, {
  displayName: { text: "A and B Pest Control, Inc." },
  primaryType: "pest_control_service",
  addressComponents: [
    { longText: "Llano County", shortText: "Llano County", types: ["administrative_area_level_2"] },
    { longText: "Texas", shortText: "TX", types: ["administrative_area_level_1"] }
  ],
  businessStatus: "OPERATIONAL"
});
assert.equal(sameStateDifferentCounty.plausible, true);
assert(sameStateDifferentCounty.reasons.includes("conflicting_county"));

const directory = await mkdtemp(resolve(tmpdir(), "lodesta-prospect-research-"));
try {
  const repository = new LocalPlatformOperationsRepository(resolve(directory, "operations.json"));
  const records = prospectImportSchema.parse({ records: [{
    prospect: {
      canonicalKey: "business:4-a pest control:san antonio:tx",
      businessName: "4-A Pest Control, LLC",
      vertical: "pest_control",
      researchState: "matched",
      websitePlatform: "Unknown",
      businessEmail: "hello@example.com"
    },
    locations: [{
      canonicalKey: "business:4-a pest control:san antonio:tx:primary",
      kind: "service_area",
      locality: "San Antonio",
      region: "TX",
      countryCode: "US",
      isPrimary: true,
      googlePlaceId: "ChIJwY3dg0X1GQkRdtIgv2aw4Zk",
      googleBusinessName: "4-A Pest Control, LLC",
      googleCategory: "Pest control service",
      googlePhone: "+12106820014",
      googleRating: 5,
      googleReviewCount: 4
    }],
    contacts: [{
      fullName: "Example Owner",
      roleTitle: "Owner",
      phone: "+12106820014",
      isPrimary: true
    }]
  }] }).records;

  const imported = await repository.importProspectResearch(records);
  assert.deepEqual(imported, { prospects: 1, locations: 1, contacts: 1 });
  const matched = await repository.listProspectCandidates({ filters: [{ field: "research_state", operator: "equals", value: "matched" }] });
  assert.equal(matched.length, 1);
  assert.equal(matched[0]?.googlePlaceId, "ChIJwY3dg0X1GQkRdtIgv2aw4Zk");
  assert.equal(matched[0]?.googleReviewCount, 4);
  assert.equal(matched[0]?.businessEmail, "hello@example.com");
  assert.equal(matched[0]?.primaryContactName, "Example Owner");
  assert.equal(matched[0]?.primaryContactRole, "Owner");
  assert.equal(matched[0]?.outreachEmail, "hello@example.com");
  assert.equal(matched[0]?.outreachPhone, "+12106820014");
  console.log(JSON.stringify({ ok: true, contract: "business-locations-contacts-v1" }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
