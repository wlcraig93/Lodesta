import { readFile } from "node:fs/promises";
import { validateWorkspaceSourcePolicy, type WorkspaceSourcePolicyFile } from "./source-policy";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Source-policy input path is required.");
const input = JSON.parse(await readFile(inputPath, "utf8")) as WorkspaceSourcePolicyFile[] | {
  files: WorkspaceSourcePolicyFile[];
  runtimeSeriesId?: string;
};
const files = Array.isArray(input) ? input : input.files;
const findings = validateWorkspaceSourcePolicy(files, Array.isArray(input) ? undefined : { runtimeSeriesId: input.runtimeSeriesId });
console.log(JSON.stringify({ ok: findings.length === 0, findings }));
if (findings.length) process.exitCode = 2;
