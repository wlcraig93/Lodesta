import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { prospectImportSchema } from "../packages/prospect-research";

const inputPath = resolve(process.argv[2] ?? "");
const batchSize = Number(process.argv[3] ?? 25);
if (!process.argv[2] || !Number.isInteger(batchSize) || batchSize < 1) {
  throw new Error("Usage: split-prospect-import.ts <input.json> [batch-size]");
}
const parsed = prospectImportSchema.parse(JSON.parse(await readFile(inputPath, "utf8")));
const stem = basename(inputPath, extname(inputPath));
const outputDirectory = resolve(dirname(inputPath), `${stem}-batches`);
await mkdir(outputDirectory, { recursive: true });
const paths: string[] = [];
for (let offset = 0; offset < parsed.records.length; offset += batchSize) {
  const number = Math.floor(offset / batchSize) + 1;
  const outputPath = resolve(outputDirectory, `${stem}-${String(number).padStart(2, "0")}.json`);
  await writeFile(outputPath, `${JSON.stringify({ records: parsed.records.slice(offset, offset + batchSize) }, null, 2)}\n`, "utf8");
  paths.push(outputPath);
}
console.log(JSON.stringify({ ok: true, inputPath, batchSize, batches: paths.length, paths }, null, 2));
