import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compareRetainedSourcePreparations } from "@/packages/business-data";
import {
  businessStateSchema,
  sourceSnapshotSchema
} from "@/packages/site-contracts";

const path = process.argv[2];
if (!path) {
  process.stderr.write("Usage: npm run diagnose:source-preparations -- path/to/retained-pairs.json\n");
  process.exit(1);
}

const input = JSON.parse(await readFile(resolve(process.cwd(), path), "utf8")) as {
  beforeSnapshot: unknown;
  beforeState: unknown;
  afterSnapshot: unknown;
  afterState: unknown;
};
const result = compareRetainedSourcePreparations({
  beforeSnapshot: sourceSnapshotSchema.parse(input.beforeSnapshot),
  beforeState: businessStateSchema.parse(input.beforeState),
  afterSnapshot: sourceSnapshotSchema.parse(input.afterSnapshot),
  afterState: businessStateSchema.parse(input.afterState)
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
