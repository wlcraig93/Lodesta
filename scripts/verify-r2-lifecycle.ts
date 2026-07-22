import "./load-env";
import assert from "node:assert/strict";
import {
  agentRunEventsLifecycleRule,
  assertAgentRunEventsLifecyclePolicy,
  listR2LifecycleRules,
  parseR2LifecycleRules
} from "./r2-lifecycle-policy";

const expected = rule(agentRunEventsLifecycleRule.name, "agent-run-events/", "Expire objects after 1 day");
const unrelated = rule("workspace-archive-retention", "workspace-backups/", "Expire objects after 30 days");
assert.doesNotThrow(() => assertAgentRunEventsLifecyclePolicy(parseR2LifecycleRules(`${expected}\n${unrelated}`)));
assert.throws(() => assertAgentRunEventsLifecyclePolicy(parseR2LifecycleRules(unrelated)));
assert.throws(() => assertAgentRunEventsLifecyclePolicy(parseR2LifecycleRules(`${expected}\n${rule("duplicate", "agent-run-events/", "Expire objects after 1 day")}`)));
assert.throws(() => assertAgentRunEventsLifecyclePolicy(parseR2LifecycleRules(`${expected}\n${rule("overlap", "agent-run-events/private/", "Expire objects after 2 days")}`)));
assert.throws(() => assertAgentRunEventsLifecyclePolicy(parseR2LifecycleRules(rule(agentRunEventsLifecycleRule.name, "agent-run-events/", "Expire objects after 2 days"))));

const bucket = process.env.LODESTA_ARTIFACT_BUCKET ?? "lodesta-agentic-sites-v1";
const rules = await listR2LifecycleRules(bucket);
const verified = assertAgentRunEventsLifecyclePolicy(rules);
process.stdout.write(`${JSON.stringify({ ok: true, bucket, verified, totalRules: rules.length })}\n`);

function rule(name: string, prefix: string, action: string) {
  return `Name: ${name}\nEnabled: Yes\nPrefix: ${prefix}\nAction: ${action}\n`;
}
