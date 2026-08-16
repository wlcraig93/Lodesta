import "./load-env";

import assert from "node:assert/strict";
import { sha256, stableJson } from "../packages/business-data";
import { assertHostedExecutionAuthority } from "../packages/execution-environment";
import { sitePlatformRepository } from "../packages/platform-data";
import { siteAuthoringWorkflow } from "../packages/site-platform/workflow";

const command = process.argv[2];
assert.equal(command, "requeue", "Usage: operator:site-authoring -- requeue --run-id=<id> --execution-number=<n> --operator-id=<id> [--apply --confirm=<hash>]");

assertHostedExecutionAuthority("release", "operator_requeue");
const runId = requiredOption("run-id");
const operatorId = requiredOption("operator-id");
const executionNumber = Number(requiredOption("execution-number"));
assert(Number.isInteger(executionNumber) && executionNumber >= 1, "--execution-number must be a positive integer.");

const run = await sitePlatformRepository.getAgentRun(runId);
assert(run, `Run ${runId} does not exist.`);
const confirmation = sha256(stableJson({
  action: "operator_requeue",
  runId,
  executionNumber,
  operatorId
}));
const report = {
  ok: true,
  action: "requeue",
  apply: process.argv.includes("--apply"),
  runId,
  expectedExecutionNumber: executionNumber,
  retainedExecutionNumber: run.executionNumber,
  status: run.status,
  heartbeatAt: run.heartbeatAt,
  sandboxDeploymentId: run.sandboxDeploymentId,
  confirmation
};

if (!process.argv.includes("--apply")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

assert.equal(requiredOption("confirm"), confirmation, "--confirm does not match the reviewed requeue report.");
assert.equal(run.status, "running", "Only a currently running run can be requeued.");
assert.equal(run.executionNumber, executionNumber, "The run execution changed after the report was reviewed.");

const requeued = await siteAuthoringWorkflow.operatorRequeueRun({ runId, expectedExecutionNumber: executionNumber, operatorId });
process.stdout.write(`${JSON.stringify({
  ...report,
  result: { status: requeued.status, executionNumber: requeued.executionNumber }
}, null, 2)}\n`);

function requiredOption(name: string) {
  const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  const index = process.argv.indexOf(`--${name}`);
  const value = inline?.slice(name.length + 3) ?? (index >= 0 ? process.argv[index + 1] : undefined);
  assert(value && !value.startsWith("--"), `--${name} is required.`);
  return value;
}
