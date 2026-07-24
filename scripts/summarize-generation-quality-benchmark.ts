import { readFile } from "node:fs/promises";
import {
  summarizeGenerationQualityBenchmark,
  type GenerationQualityBenchmarkInput
} from "../packages/website-assessment/generation-quality-benchmark";

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Usage: npm run summarize:generation-quality-benchmark -- <benchmark-runs.json>");
}
const input = JSON.parse(await readFile(inputPath, "utf8")) as GenerationQualityBenchmarkInput;
process.stdout.write(`${JSON.stringify(summarizeGenerationQualityBenchmark(input), null, 2)}\n`);
