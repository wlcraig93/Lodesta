import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const NAICS_EMPLOYER = "561710";
const NAICS_NONEMPLOYER = "56171";
const STATE_CODES: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
  "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
  "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
  "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY"
};

type Benchmark = {
  jurisdiction: string;
  name: string;
  employerFirms: number;
  employerFirmsUnder20: number;
  employerEstablishments: number;
  nonemployerEstablishments: number;
  rawFirmLikeUniverse: number;
  smbShapedUniverse: number;
};

const args = process.argv.slice(2);
const susbPath = requiredArg("--susb");
const nonemployerZipPath = requiredArg("--nonemployer-zip");
const outputPath = resolve(optionalArg("--output")
  ?? ".data/prospect-research/pest-control-us-census-benchmarks.json");

const byFips = new Map<string, Benchmark>();
await readSusb();
await readNonemployers();

const states = [...byFips.values()]
  .filter((row) => row.jurisdiction !== "US")
  .sort((left, right) => left.jurisdiction.localeCompare(right.jurisdiction));
const national = byFips.get("00");
if (!national) throw new Error("The SUSB input did not contain a United States pest-control total.");
national.nonemployerEstablishments ||= states.reduce((sum, state) => sum + state.nonemployerEstablishments, 0);
finalize(national);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  vertical: "pest_control",
  employerSource: {
    publisher: "U.S. Census Bureau",
    dataset: "2022 Statistics of U.S. Businesses",
    naics: NAICS_EMPLOYER,
    sourceUrl: "https://www.census.gov/data/datasets/2022/econ/susb/2022-susb.html"
  },
  nonemployerSource: {
    publisher: "U.S. Census Bureau",
    dataset: "2023 Nonemployer Statistics",
    naics: NAICS_NONEMPLOYER,
    sourceUrl: "https://www2.census.gov/programs-surveys/nonemployer-statistics/data/2023/"
  },
  definitions: {
    rawFirmLikeUniverse: "Employer firms plus nonemployer establishments; directional, not a de-duplicated license universe.",
    smbShapedUniverse: "Employer firms with fewer than 20 employees plus nonemployer establishments."
  },
  national,
  states
}, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  outputPath,
  states: states.length,
  nationalRawFirmLikeUniverse: national.rawFirmLikeUniverse,
  nationalSmbShapedUniverse: national.smbShapedUniverse
}, null, 2)}\n`);

async function readSusb() {
  const lines = createInterface({ input: createReadStream(susbPath), crlfDelay: Infinity });
  let headers: string[] | undefined;
  for await (const line of lines) {
    const values = line.split(",");
    if (!headers) {
      headers = values;
      continue;
    }
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    if (row.NAICS !== NAICS_EMPLOYER || !["01", "33"].includes(row.ENTRSIZE)) continue;
    const jurisdiction = row.STATE === "00" ? "US" : STATE_CODES[row.STATE];
    if (!jurisdiction) continue;
    const benchmark = byFips.get(row.STATE) ?? {
      jurisdiction,
      name: row.STATEDSCR,
      employerFirms: 0,
      employerFirmsUnder20: 0,
      employerEstablishments: 0,
      nonemployerEstablishments: 0,
      rawFirmLikeUniverse: 0,
      smbShapedUniverse: 0
    };
    if (row.ENTRSIZE === "01") {
      benchmark.employerFirms = integer(row.FIRM);
      benchmark.employerEstablishments = integer(row.ESTB);
    } else {
      benchmark.employerFirmsUnder20 = integer(row.FIRM);
    }
    byFips.set(row.STATE, benchmark);
  }
}

async function readNonemployers() {
  const unzip = spawn("unzip", ["-p", nonemployerZipPath, "NS2300NONEMP.dat"], {
    stdio: ["ignore", "pipe", "inherit"]
  });
  if (!unzip.stdout) throw new Error("Unable to read the nonemployer archive.");
  const lines = createInterface({ input: unzip.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.startsWith("#")) continue;
    const columns = line.split("|");
    const [
      geoType, stateFips, , , , , geoLabel, , naics, , , legalForm, , revenueSize, , , establishments
    ] = columns;
    if (!["01", "02"].includes(geoType)
      || naics !== NAICS_NONEMPLOYER
      || legalForm !== "001"
      || revenueSize !== "001") continue;
    const jurisdiction = stateFips === "00" ? "US" : STATE_CODES[stateFips];
    if (!jurisdiction) continue;
    const benchmark = byFips.get(stateFips) ?? {
      jurisdiction,
      name: geoLabel,
      employerFirms: 0,
      employerFirmsUnder20: 0,
      employerEstablishments: 0,
      nonemployerEstablishments: 0,
      rawFirmLikeUniverse: 0,
      smbShapedUniverse: 0
    };
    benchmark.nonemployerEstablishments = integer(establishments);
    finalize(benchmark);
    byFips.set(stateFips, benchmark);
  }
  const exitCode = await new Promise<number | null>((resolveExit) => unzip.once("close", resolveExit));
  if (exitCode !== 0) throw new Error(`Unable to extract the nonemployer archive (exit ${exitCode}).`);
}

function finalize(benchmark: Benchmark) {
  benchmark.rawFirmLikeUniverse = benchmark.employerFirms + benchmark.nonemployerEstablishments;
  benchmark.smbShapedUniverse = benchmark.employerFirmsUnder20 + benchmark.nonemployerEstablishments;
}

function integer(value?: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requiredArg(name: string) {
  const value = optionalArg(name);
  if (!value) throw new Error(`Missing required ${name} path.`);
  return resolve(value);
}

function optionalArg(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
