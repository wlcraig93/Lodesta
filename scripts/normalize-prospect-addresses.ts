import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getSupabaseAdminClient } from "../lib/supabase/client";

type SourceRow = { cells?: Record<string, unknown> };
type SourceAddress = { street: string; locality: string; postalCode: string };
type LocationRow = {
  id: string;
  prospect_id: string;
  canonical_key: string;
  kind: "headquarters" | "branch" | "service_area" | "mailing" | "unknown";
  address_line_1: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  is_primary: boolean;
};
type LocationRepair = {
  id: string;
  prospect_id: string;
  canonical_key: string;
  kind: LocationRow["kind"];
  address_line_1: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  is_primary: boolean;
  updated_at: string;
};
type LocationRepairInput = Pick<LocationRepair, "id" | "address_line_1" | "updated_at">
  & Partial<Pick<LocationRepair, "locality" | "region" | "postal_code">>;
type NormalizedSourceLocation = {
  canonicalKey?: string;
  addressLine1?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
};

const FLORIDA_KEY_PREFIX = "license-location:fl-fdacs:";
const defaultFloridaSource = ".data/prospect-research/raw/fl-fdacs-pest-control-business-licenses-2026-07-29.json";
const defaultNormalizedSource = ".data/prospect-research/pest-control-us-normalized-license-import.json";
const apply = process.argv.includes("--apply");
const floridaSourcePath = resolve(stringArgument("--florida-source") ?? defaultFloridaSource);
const normalizedSourcePath = resolve(stringArgument("--normalized-source") ?? defaultNormalizedSource);
const client = getSupabaseAdminClient();

const [sourceAddresses, normalizedSourceLocations, locations] = await Promise.all([
  readFloridaSourceAddresses(floridaSourcePath),
  readNormalizedSourceLocations(normalizedSourcePath),
  readAllLocations()
]);
const repairs = new Map<string, LocationRepair>();
const unresolved: Array<{ canonicalKey: string; reason: string }> = [];
const examples: Array<{ canonicalKey: string; before: Partial<LocationRow>; after: Partial<LocationRepair> }> = [];
const now = new Date().toISOString();
let floridaRepairs = 0;
let stateOnlyStreetRepairs = 0;
let localityCompositeRepairs = 0;
let postalFormatRepairs = 0;
let invalidPostalClears = 0;
let sourceComponentRestorations = 0;

for (const location of locations) {
  if (!location.canonical_key.startsWith(FLORIDA_KEY_PREFIX)) continue;
  const license = location.canonical_key.slice(FLORIDA_KEY_PREFIX.length).toUpperCase();
  const candidates = sourceAddresses.get(license);
  const sourceAddress = candidates ? selectSourceAddress(location, candidates) : undefined;
  if (!sourceAddress) {
    unresolved.push({
      canonicalKey: location.canonical_key,
      reason: candidates?.length ? "conflicting source addresses" : "no address in source"
    });
    continue;
  }
  const address = preserveStoredCase(location.locality, sourceAddress);
  if (
    normalized(location.address_line_1) === normalized(address.street)
    && normalized(location.locality) === normalized(address.locality)
    && normalized(location.region) === "fl"
    && normalized(location.postal_code) === normalized(address.postalCode)
  ) continue;
  addRepair(location, {
    id: location.id,
    address_line_1: address.street,
    locality: address.locality,
    region: "FL",
    postal_code: address.postalCode,
    updated_at: now
  });
  floridaRepairs += 1;
}

for (const location of locations) {
  if (location.canonical_key.startsWith("license-location:tx-tda:") && !location.region) {
    addRepair(location, { id: location.id, address_line_1: location.address_line_1, region: "TX", updated_at: now });
    sourceComponentRestorations += 1;
    continue;
  }
  const source = normalizedSourceLocations.get(location.canonical_key.toLowerCase());
  if (!source) continue;
  const sourcePostalCode = source.countryCode === "US" ? validUsPostalCode(source.postalCode) : source.postalCode?.trim();
  const locality = location.locality ?? source.locality ?? null;
  const region = location.region ?? source.region?.toUpperCase() ?? null;
  const postalCode = location.postal_code ?? sourcePostalCode ?? null;
  if (
    location.locality === locality
    && location.region === region
    && location.postal_code === postalCode
  ) continue;
  addRepair(location, {
    id: location.id,
    address_line_1: location.address_line_1,
    locality,
    region,
    postal_code: postalCode,
    updated_at: now
  });
  sourceComponentRestorations += 1;
}

for (const location of locations) {
  if (!location.postal_code || location.country_code !== "US") continue;
  const postalCode = location.postal_code.trim();
  const zipPlusFour = postalCode.match(/^(\d{5})-\s*(\d{4})$/);
  if (zipPlusFour) {
    const normalizedPostalCode = `${zipPlusFour[1]}-${zipPlusFour[2]}`;
    if (postalCode !== normalizedPostalCode) {
      addRepair(location, { id: location.id, address_line_1: location.address_line_1, postal_code: normalizedPostalCode, updated_at: now });
      postalFormatRepairs += 1;
    }
  } else if (!/^\d{5}$/.test(postalCode)) {
    addRepair(location, { id: location.id, address_line_1: location.address_line_1, postal_code: null, updated_at: now });
    invalidPostalClears += 1;
  }
}

for (const location of locations) {
  if (!location.address_line_1) continue;
  if (location.region && normalized(location.address_line_1) === normalized(location.region)) {
    addRepair(location, { id: location.id, address_line_1: null, updated_at: now });
    stateOnlyStreetRepairs += 1;
    continue;
  }
  if (!location.locality || !location.region) continue;
  const localityComposite = [location.locality, location.region, location.postal_code].filter(Boolean).join(" ");
  if (!/^\s*\d/.test(location.address_line_1) && normalized(location.address_line_1) === normalized(localityComposite)) {
    addRepair(location, { id: location.id, address_line_1: null, updated_at: now });
    localityCompositeRepairs += 1;
  }
}

const repairRows = [...repairs.values()];
if (apply) {
  for (const batch of chunks(repairRows, 250)) {
    const result = await client.from("prospect_locations").upsert(batch, { onConflict: "id" }).select("id");
    if (result.error) throw new Error(`Apply prospect address repairs: ${result.error.message}`);
    if ((result.data ?? []).length !== batch.length) throw new Error("Prospect address repair returned an unexpected row count.");
  }
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry_run",
  floridaSourcePath,
  totalLocations: locations.length,
  proposedRepairs: repairRows.length,
  floridaRepairs,
  stateOnlyStreetRepairs,
  localityCompositeRepairs,
  postalFormatRepairs,
  invalidPostalClears,
  sourceComponentRestorations,
  unresolved,
  examples
}, null, 2));

function addRepair(location: LocationRow, next: LocationRepairInput) {
  const current = repairs.get(location.id);
  const baseline = {
    address_line_1: location.address_line_1,
    locality: location.locality,
    region: location.region,
    postal_code: location.postal_code
  };
  const merged = {
    ...baseline,
    ...current,
    ...next,
    id: location.id,
    prospect_id: location.prospect_id,
    canonical_key: location.canonical_key,
    kind: location.kind,
    country_code: location.country_code,
    is_primary: location.is_primary
  };
  repairs.set(location.id, merged);
  if (examples.length < 12 && !current) {
    examples.push({
      canonicalKey: location.canonical_key,
      before: {
        address_line_1: location.address_line_1,
        locality: location.locality,
        region: location.region,
        postal_code: location.postal_code
      },
      after: merged
    });
  }
}

async function readNormalizedSourceLocations(path: string) {
  const source = JSON.parse(await readFile(path, "utf8")) as {
    records?: Array<{ prospect?: NormalizedSourceLocation; locations?: NormalizedSourceLocation[] }>;
  };
  const locations = new Map<string, NormalizedSourceLocation>();
  for (const record of source.records ?? []) {
    for (const location of record.locations ?? []) {
      if (location.canonicalKey) locations.set(location.canonicalKey.toLowerCase(), { ...record.prospect, ...location });
    }
  }
  return locations;
}

async function readFloridaSourceAddresses(path: string) {
  const source = JSON.parse(await readFile(path, "utf8")) as { rows?: SourceRow[] };
  const byLicense = new Map<string, Map<string, SourceAddress>>();
  for (const row of source.rows ?? []) {
    const cells = row.cells ?? {};
    const license = stringValue(cells["doacs_license.License Number"])?.toUpperCase();
    const rawAddress = stringValue(cells["account.Address 1"]);
    if (!license || !rawAddress) continue;
    const lines = rawAddress.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
    const localityAndPostal = lines.at(-1)?.match(/^(.*?)\s+(\d{5}(?:-\d{4})?)$/);
    if (!localityAndPostal || lines.length < 2) continue;
    const address = {
      street: lines.slice(0, -1).join(", "),
      locality: localityAndPostal[1]!.trim(),
      postalCode: localityAndPostal[2]!
    };
    const values = byLicense.get(license) ?? new Map<string, SourceAddress>();
    values.set([address.street, address.locality, address.postalCode].map(normalized).join("|"), address);
    byLicense.set(license, values);
  }
  return new Map([...byLicense].map(([license, values]) => [license, [...values.values()]]));
}

function selectSourceAddress(location: LocationRow, candidates: SourceAddress[]) {
  if (candidates.length === 1) return candidates[0];
  const flattened = normalized(location.locality);
  const structured = normalized(`${location.address_line_1 ?? ""} ${location.locality ?? ""}`);
  const matches = candidates.filter((candidate) => {
    const candidateAddress = normalized(`${candidate.street} ${candidate.locality}`);
    return flattened === candidateAddress || structured === candidateAddress;
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function preserveStoredCase(flattened: string | null, source: SourceAddress): SourceAddress {
  if (normalized(flattened) !== normalized(`${source.street} ${source.locality}`)) return source;
  const localityPattern = new RegExp(`${escapeRegExp(source.locality).replaceAll(/\s+/g, "\\s+")}$`, "i");
  const localityMatch = localityPattern.exec(flattened!.trim());
  if (!localityMatch || localityMatch.index === 0) return source;
  return {
    street: flattened!.slice(0, localityMatch.index).trim(),
    locality: localityMatch[0].trim(),
    postalCode: source.postalCode
  };
}

async function readAllLocations() {
  const rows: LocationRow[] = [];
  for (let start = 0; ; start += 1000) {
    const result = await client.from("prospect_locations")
      .select("id,prospect_id,canonical_key,kind,address_line_1,locality,region,postal_code,country_code,is_primary")
      .order("id", { ascending: true })
      .range(start, start + 999);
    if (result.error) throw new Error(`Read prospect locations: ${result.error.message}`);
    const page = (result.data ?? []) as LocationRow[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function stringArgument(name: string) {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || undefined;
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim();
}

function validUsPostalCode(value: string | undefined) {
  if (!value) return undefined;
  const zipPlusFour = value.trim().match(/^(\d{5})-\s*(\d{4})$/);
  if (zipPlusFour) return `${zipPlusFour[1]}-${zipPlusFour[2]}`;
  return /^\d{5}$/.test(value.trim()) ? value.trim() : undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
