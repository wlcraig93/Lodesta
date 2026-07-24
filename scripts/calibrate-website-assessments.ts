import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { summarizeAssessmentCalibration } from "../packages/website-assessment/calibration";

const path = process.argv[2];
if (!path) {
  process.stderr.write("Usage: npm run calibrate:website-assessments -- path/to/calibration.json\n");
  process.exit(1);
}

const dataset = JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
process.stdout.write(`${JSON.stringify(summarizeAssessmentCalibration(dataset), null, 2)}\n`);
