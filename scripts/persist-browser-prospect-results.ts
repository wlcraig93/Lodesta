import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { getSupabaseAdminClient } from "../lib/supabase/client";

type BrowserDisposition =
  | "matched"
  | "verified_no_google"
  | "ambiguous"
  | "unresolved"
  | "not_target"
  | "invalid_source"
  | "duplicate";

type BrowserResult = {
  prospect_id: string;
  browser_disposition: BrowserDisposition;
  final_website_url?: string | null;
  final_business_email?: string | null;
  final_phone?: string | null;
  website_platform?: string | null;
  website_agency_provider?: string | null;
  google_business_name?: string | null;
  google_category?: string | null;
  google_address?: string | null;
  google_phone?: string | null;
  google_website_url?: string | null;
  google_maps_url?: string | null;
  google_place_id?: string | null;
  google_rating?: number | null;
  google_review_count?: number | null;
  address_update?: {
    address_line_1: string;
    address_line_2?: string | null;
    locality: string;
    region: string;
    postal_code: string;
    country_code?: string | null;
  } | null;
  owner_contact?: {
    full_name: string;
    role_title?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  additional_contacts?: Array<{
    full_name: string;
    role_title?: string | null;
    email?: string | null;
    phone?: string | null;
  }>;
  additional_locations?: Array<{
    address_line_1: string;
    address_line_2?: string | null;
    locality: string;
    region: string;
    postal_code: string;
    country_code?: string | null;
    phone?: string | null;
  }>;
};

type ResultsFile = {
  results: BrowserResult[];
};

const inputPath = argument("--input");
if (!inputPath) throw new Error("--input requires a browser results JSON path.");

const payload = JSON.parse(await readFile(resolve(inputPath), "utf8")) as ResultsFile;
const client = getSupabaseAdminClient();
const summary = {
  prospectsUpdated: 0,
  locationsUpdated: 0,
  googleMatchesPersisted: 0,
  placeIdsPersisted: 0,
  addressesPersisted: 0,
  ownerContactsPersisted: 0,
  additionalContactsPersisted: 0,
  additionalLocationsPersisted: 0,
  placeIdConflicts: [] as Array<{ prospectId: string; placeId: string; connectedProspectId: string }>
};

for (const result of payload.results) {
  const prospectUpdate: Record<string, unknown> = {
    research_state: researchState(result.browser_disposition)
  };
  assign(prospectUpdate, "website_url", result.final_website_url);
  assign(prospectUpdate, "business_email", result.final_business_email);
  assign(prospectUpdate, "website_platform", result.website_platform);
  assign(prospectUpdate, "website_agency_provider", result.website_agency_provider);

  const prospectWrite = await client
    .from("prospects")
    .update(prospectUpdate)
    .eq("id", result.prospect_id)
    .select("id")
    .single();
  if (prospectWrite.error) {
    throw new Error(`Update prospect ${result.prospect_id}: ${prospectWrite.error.message}`);
  }
  summary.prospectsUpdated += 1;

  const locationRead = await client
    .from("prospect_locations")
    .select("id,phone,address_line_1,address_line_2,locality,region,postal_code,country_code")
    .eq("prospect_id", result.prospect_id)
    .order("is_primary", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (locationRead.error) {
    throw new Error(`Read location ${result.prospect_id}: ${locationRead.error.message}`);
  }

  if (result.owner_contact) {
    const existingContact = await client
      .from("prospect_contacts")
      .select("id")
      .eq("prospect_id", result.prospect_id)
      .ilike("full_name", result.owner_contact.full_name)
      .limit(1)
      .maybeSingle();
    if (existingContact.error) {
      throw new Error(`Read owner contact ${result.prospect_id}: ${existingContact.error.message}`);
    }
    const contactId = existingContact.data?.id ?? `prospect_contact_${createHash("md5")
      .update(`${result.prospect_id}|${result.owner_contact.full_name.toLowerCase()}`)
      .digest("hex")}`;
    const demoteWrite = await client
      .from("prospect_contacts")
      .update({ is_primary: false })
      .eq("prospect_id", result.prospect_id)
      .eq("is_primary", true);
    if (demoteWrite.error) {
      throw new Error(`Demote contacts ${result.prospect_id}: ${demoteWrite.error.message}`);
    }
    const contactWrite = await client.from("prospect_contacts").upsert({
      id: contactId,
      prospect_id: result.prospect_id,
      full_name: result.owner_contact.full_name,
      role_title: result.owner_contact.role_title ?? null,
      email: result.owner_contact.email ?? null,
      phone: result.owner_contact.phone ?? null,
      is_primary: true,
      updated_at: new Date().toISOString()
    }, { onConflict: "id" });
    if (contactWrite.error) {
      throw new Error(`Upsert owner contact ${result.prospect_id}: ${contactWrite.error.message}`);
    }
    summary.ownerContactsPersisted += 1;
  }

  for (const contact of result.additional_contacts ?? []) {
    const contactId = `prospect_contact_${createHash("md5")
      .update(`${result.prospect_id}|${contact.full_name.toLowerCase()}`)
      .digest("hex")}`;
    const contactWrite = await client.from("prospect_contacts").upsert({
      id: contactId,
      prospect_id: result.prospect_id,
      full_name: contact.full_name,
      role_title: contact.role_title ?? null,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      is_primary: false,
      updated_at: new Date().toISOString()
    }, { onConflict: "id" });
    if (contactWrite.error) {
      throw new Error(`Upsert additional contact ${result.prospect_id}: ${contactWrite.error.message}`);
    }
    summary.additionalContactsPersisted += 1;
  }

  for (const location of result.additional_locations ?? []) {
    const canonicalKey = `address:${[
      location.address_line_1,
      location.address_line_2,
      location.locality,
      location.region,
      location.postal_code,
      location.country_code ?? "US"
    ].filter(Boolean).join("|").toLowerCase().replace(/[^a-z0-9|]+/g, " ").trim()}`;
    const locationId = `prospect_location_${createHash("md5")
      .update(`${result.prospect_id}|${canonicalKey}`)
      .digest("hex")}`;
    const locationWrite = await client.from("prospect_locations").upsert({
      id: locationId,
      prospect_id: result.prospect_id,
      canonical_key: canonicalKey,
      kind: "branch",
      address_line_1: location.address_line_1,
      address_line_2: location.address_line_2 ?? null,
      locality: location.locality,
      region: location.region,
      postal_code: location.postal_code,
      country_code: location.country_code ?? "US",
      phone: location.phone ?? null,
      is_primary: false,
      updated_at: new Date().toISOString()
    }, { onConflict: "prospect_id,canonical_key" });
    if (locationWrite.error) {
      throw new Error(`Upsert additional location ${result.prospect_id}: ${locationWrite.error.message}`);
    }
    summary.additionalLocationsPersisted += 1;
  }

  if (!locationRead.data) continue;

  const locationUpdate: Record<string, unknown> = {};
  if (!locationRead.data.phone) assign(locationUpdate, "phone", result.final_phone);

  if (result.address_update && !locationRead.data.address_line_1) {
    assign(locationUpdate, "address_line_1", result.address_update.address_line_1);
    assign(locationUpdate, "address_line_2", result.address_update.address_line_2);
    assign(locationUpdate, "locality", result.address_update.locality);
    assign(locationUpdate, "region", result.address_update.region);
    assign(locationUpdate, "postal_code", result.address_update.postal_code);
    assign(locationUpdate, "country_code", result.address_update.country_code ?? "US");
    summary.addressesPersisted += 1;
  }

  if (result.browser_disposition === "matched") {
    assign(locationUpdate, "google_business_name", result.google_business_name);
    assign(locationUpdate, "google_category", result.google_category);
    assign(locationUpdate, "google_address", result.google_address);
    assign(locationUpdate, "google_phone", result.google_phone);
    assign(locationUpdate, "google_website_url", result.google_website_url);
    assign(locationUpdate, "google_maps_url", result.google_maps_url);
    if (result.google_review_count !== undefined && result.google_review_count !== null) {
      locationUpdate.google_review_count = result.google_review_count;
      locationUpdate.google_rating = result.google_rating ?? null;
    }

    if (result.google_place_id) {
      const connected = await client
        .from("prospect_locations")
        .select("prospect_id")
        .eq("google_place_id", result.google_place_id)
        .neq("prospect_id", result.prospect_id)
        .limit(1)
        .maybeSingle();
      if (connected.error) {
        throw new Error(`Check Place ID ${result.google_place_id}: ${connected.error.message}`);
      }
      if (connected.data) {
        summary.placeIdConflicts.push({
          prospectId: result.prospect_id,
          placeId: result.google_place_id,
          connectedProspectId: connected.data.prospect_id
        });
      } else {
        locationUpdate.google_place_id = result.google_place_id;
        summary.placeIdsPersisted += 1;
      }
    }
    summary.googleMatchesPersisted += 1;
  }

  if (Object.keys(locationUpdate).length === 0) continue;
  const locationWrite = await client
    .from("prospect_locations")
    .update(locationUpdate)
    .eq("id", locationRead.data.id)
    .select("id")
    .single();
  if (locationWrite.error) {
    throw new Error(`Update location ${locationRead.data.id}: ${locationWrite.error.message}`);
  }
  summary.locationsUpdated += 1;
}

const prospectIds = payload.results.map((result) => result.prospect_id);
const [locationVerification, contactVerification] = await Promise.all([
  client
    .from("prospect_locations")
    .select("prospect_id,address_line_1,locality,region,postal_code,google_maps_url,google_place_id")
    .in("prospect_id", prospectIds),
  client
    .from("prospect_contacts")
    .select("prospect_id,full_name,role_title,is_primary")
    .in("prospect_id", prospectIds)
]);
if (locationVerification.error) {
  throw new Error(`Verify locations: ${locationVerification.error.message}`);
}
if (contactVerification.error) {
  throw new Error(`Verify contacts: ${contactVerification.error.message}`);
}
const expectedOwners = new Set(payload.results
  .filter((result) => result.owner_contact)
  .map((result) => `${result.prospect_id}|${result.owner_contact?.full_name.toLowerCase()}`));
const verification = {
  locationsWithMapsLinks: locationVerification.data.filter((location) => location.google_maps_url).length,
  locationsWithExactPlaceIds: locationVerification.data.filter((location) => location.google_place_id).length,
  requestedAddressesPresent: payload.results.filter((result) => result.address_update).filter((result) =>
    locationVerification.data.some((location) =>
      location.prospect_id === result.prospect_id
      && location.address_line_1?.toLowerCase() === result.address_update?.address_line_1.toLowerCase()
      && location.locality?.toLowerCase() === result.address_update?.locality.toLowerCase()
      && location.region === result.address_update?.region
      && location.postal_code === result.address_update?.postal_code
    )
  ).length,
  expectedAddresses: payload.results.filter((result) => result.address_update).length,
  requestedAddressMismatches: payload.results.filter((result) => result.address_update).filter((result) =>
    !locationVerification.data.some((location) =>
      location.prospect_id === result.prospect_id
      && location.address_line_1?.toLowerCase() === result.address_update?.address_line_1.toLowerCase()
      && location.locality?.toLowerCase() === result.address_update?.locality.toLowerCase()
      && location.region === result.address_update?.region
      && location.postal_code === result.address_update?.postal_code
    )
  ).map((result) => ({
    prospectId: result.prospect_id,
    expected: result.address_update,
    actual: locationVerification.data.filter((location) => location.prospect_id === result.prospect_id)
  })),
  confirmedOwnersPresent: contactVerification.data.filter((contact) =>
    expectedOwners.has(`${contact.prospect_id}|${contact.full_name.toLowerCase()}`)
  ).length,
  expectedOwners: expectedOwners.size
};

console.log(JSON.stringify({ ...summary, verification }, null, 2));

function assign(target: Record<string, unknown>, key: string, value: unknown) {
  if (value !== undefined && value !== null && value !== "") target[key] = value;
}

function researchState(disposition: BrowserDisposition) {
  if (disposition === "matched") return "matched";
  if (disposition === "ambiguous") return "ambiguous";
  if (disposition === "unresolved") return "not_found";
  return "no_result";
}

function argument(name: string) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}
