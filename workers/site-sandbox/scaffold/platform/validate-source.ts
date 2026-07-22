import { readFile } from "node:fs/promises";
import { validateWorkspaceSourcePolicy, type WorkspaceSourcePolicyFile } from "./source-policy";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Source-policy input path is required.");
const files = JSON.parse(await readFile(inputPath, "utf8")) as WorkspaceSourcePolicyFile[];
const findings = validateWorkspaceSourcePolicy(files);
console.log(JSON.stringify({ ok: findings.length === 0, findings }));
if (findings.length) process.exitCode = 2;
