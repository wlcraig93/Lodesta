import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { canonicalProspectKey, prospectImportSchema, type ProspectImportRecord } from "../packages/prospect-research";

type FlatRecord = Record<string, unknown>;

const args = process.argv.slice(2);
const inputPath = args.find((argument) => !argument.startsWith("--"));
const apply = args.includes("--apply");
if (!inputPath) throw new Error("Usage: npm run import:prospects -- <file.csv|json|jsonl> [--apply]");

const absolutePath = resolve(inputPath);
const rows = await readRows(absolutePath);
const records = rows.every((row) => isRecord(row.prospect))
  ? rows as unknown as ProspectImportRecord[]
  : rows.map((row, index) => importRecord(row, index));
const parsed = prospectImportSchema.parse({ records });

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry_run",
  file: absolutePath,
  prospects: parsed.records.length,
  locations: parsed.records.reduce((count, record) => count + (record.locations?.length ?? 0), 0),
  contacts: parsed.records.reduce((count, record) => count + (record.contacts?.length ?? 0), 0)
}, null, 2));

if (apply) {
  const { platformOperationsRepository } = await import("../packages/platform-operations");
  console.log(JSON.stringify({ imported: await platformOperationsRepository.importProspectResearch(parsed.records) }, null, 2));
} else {
  console.log("Dry run only. Re-run with --apply to persist this batch.");
}

function importRecord(row: FlatRecord, index: number): ProspectImportRecord {
  const businessName = required(row, "business_name", index);
  const locality = optional(row, "locality");
  const region = optional(row, "region");
  const countryCode = optional(row, "country_code")?.toUpperCase() ?? "US";
  const postalCode = normalizedPostalCode(optional(row, "postal_code"), countryCode);
  const addressLine1 = normalizedStreetAddress(optional(row, "address_line_1"), locality, region, postalCode);
  const canonicalKey = canonicalProspectKey({ explicitKey: optional(row, "canonical_key"), businessName, locality, region });
  const googlePlaceId = optional(row, "google_place_id") ?? optional(row, "place_id");
  const websiteUrl = optional(row, "website_url");
  const addressPresent = Boolean(addressLine1 || locality || googlePlaceId);
  const contacts: NonNullable<ProspectImportRecord["contacts"]> = [];
  const ownerName = optional(row, "owner_name");
  const ownerEmail = optional(row, "owner_email");
  if (ownerName) contacts.push({
    fullName: ownerName,
    roleTitle: "Owner",
    email: ownerEmail,
    isPrimary: true
  });
  addPersonContact(contacts, optional(row, "responsible_person_name"), optional(row, "responsible_person_title") ?? "Responsible person");
  addPersonContact(contacts, optional(row, "operator_name"), "Operator");
  addPersonContact(contacts, optional(row, "certified_applicator_name"), "Certified applicator");

  return {
    prospect: {
      canonicalKey,
      businessName,
      vertical: optional(row, "vertical"),
      researchState: googlePlaceId ? "matched" : "pending",
      websiteUrl,
      websitePlatform: optional(row, "website_platform"),
      websiteAgencyProvider: optional(row, "website_agency_provider"),
      businessEmail: optional(row, "business_email") ?? (ownerName ? undefined : ownerEmail)
    },
    locations: addressPresent ? [{
      canonicalKey: `${canonicalKey}:primary`,
      kind: "headquarters",
      addressLine1,
      addressLine2: optional(row, "address_line_2"),
      locality,
      region,
      postalCode,
      countryCode,
      county: optional(row, "county"),
      phone: optional(row, "phone"),
      isPrimary: true,
      googlePlaceId,
      googleBusinessName: optional(row, "google_business_name"),
      googleCategory: optional(row, "google_category"),
      googleAddress: optional(row, "google_address"),
      googlePhone: optional(row, "google_phone"),
      googleWebsiteUrl: optional(row, "google_website_url"),
      googleMapsUrl: optional(row, "google_maps_url"),
      googleRating: numeric(row, "google_rating") ?? numeric(row, "review_rating"),
      googleReviewCount: integer(row, "google_review_count") ?? integer(row, "review_count")
    }] : undefined,
    contacts: contacts.length ? contacts : undefined
  };
}

function addPersonContact(
  contacts: NonNullable<ProspectImportRecord["contacts"]>,
  fullName: string | undefined,
  roleTitle: string
) {
  if (!fullName || contacts.some((contact) => contact.fullName?.toLowerCase() === fullName.toLowerCase())) return;
  contacts.push({ fullName, roleTitle, isPrimary: !contacts.some((contact) => contact.isPrimary) });
}

async function readRows(path: string): Promise<FlatRecord[]> {
  const text = await readFile(path, "utf8");
  const extension = extname(path).toLowerCase();
  if (extension === ".csv") return csvRows(text);
  if (extension === ".jsonl" || extension === ".ndjson") return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => asRecord(JSON.parse(line)));
  const value = JSON.parse(text) as unknown;
  if (Array.isArray(value)) return value.map(asRecord);
  if (isRecord(value) && Array.isArray(value.records)) return value.records.map(asRecord);
  throw new Error("JSON imports must be an array or an object with a records array.");
}

function csvRows(text: string): FlatRecord[] {
  const rows = parseCsv(text);
  const headers = rows.shift()?.map((value) => value.trim()) ?? [];
  return rows.filter((row) => row.some((value) => value.trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!; const next = text[index + 1];
    if (character === '"' && quoted && next === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) { if (character === "\r" && next === "\n") index += 1; row.push(value); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}

function required(row: FlatRecord, key: string, index: number) { const value = optional(row, key); if (!value) throw new Error(`Row ${index + 2} requires ${key}.`); return value; }
function optional(row: FlatRecord, key: string) { const value = row[key]; return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : undefined; }
function numeric(row: FlatRecord, key: string) { const value = optional(row, key); if (!value) return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function integer(row: FlatRecord, key: string) { const value = numeric(row, key); return value === undefined ? undefined : Math.max(0, Math.round(value)); }
function normalizedPostalCode(value: string | undefined, countryCode: string) {
  if (!value || countryCode !== "US") return value;
  const zipPlusFour = value.match(/^(\d{5})-\s*(\d{4})$/);
  if (zipPlusFour) return `${zipPlusFour[1]}-${zipPlusFour[2]}`;
  return /^\d{5}$/.test(value) ? value : undefined;
}
function normalizedStreetAddress(value: string | undefined, locality: string | undefined, region: string | undefined, postalCode: string | undefined) {
  if (!value) return undefined;
  const normalizedValue = normalizedAddressToken(value);
  if (region && normalizedValue === normalizedAddressToken(region)) return undefined;
  const localityOnly = [locality, region, postalCode].filter(Boolean).join(" ");
  return locality && region && normalizedValue === normalizedAddressToken(localityOnly) ? undefined : value;
}
function normalizedAddressToken(value: string) { return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim(); }
function isRecord(value: unknown): value is FlatRecord { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function asRecord(value: unknown) { if (!isRecord(value)) throw new Error("Every imported row must be an object."); return value; }
