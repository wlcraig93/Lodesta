import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const agentRunEventsLifecycleRule = {
  name: "lodesta-expire-agent-run-events-v1",
  enabled: true,
  prefix: "agent-run-events/",
  action: "expire",
  days: 1
} as const;

export type R2LifecycleRule = {
  name: string;
  enabled: boolean;
  prefix: string;
  action: string;
};

export function parseR2LifecycleRules(output: string): R2LifecycleRule[] {
  const plain = output
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const lines = plain.split("\n").map((line) => line.trim());
  const rules: R2LifecycleRule[] = [];
  let fields = new Map<string, string>();
  const flush = () => {
    if (!fields.size) return;
    const name = fields.get("name");
    const enabled = fields.get("enabled");
    const prefix = fields.get("prefix");
    const action = fields.get("action");
    if (!name || !enabled || prefix === undefined || !action) {
      throw new Error(`Wrangler returned an unrecognized lifecycle rule: ${JSON.stringify(Object.fromEntries(fields))}`);
    }
    rules.push({ name, enabled: enabled.toLowerCase() === "yes", prefix, action });
    fields = new Map<string, string>();
  };
  for (const line of lines) {
    const match = line.match(/^([a-z]+):\s*(.*?)\s*$/i);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    if (key === "name" && fields.size) flush();
    if (["name", "enabled", "prefix", "action"].includes(key)) fields.set(key, match[2]!);
  }
  flush();
  return rules.sort((left, right) => left.name.localeCompare(right.name));
}

export function assertAgentRunEventsLifecyclePolicy(rules: R2LifecycleRule[]) {
  const expected = rules.filter((rule) => rule.name === agentRunEventsLifecycleRule.name);
  if (expected.length !== 1) {
    throw new Error(`Expected exactly one ${agentRunEventsLifecycleRule.name} lifecycle rule; found ${expected.length}.`);
  }
  const rule = expected[0]!;
  if (!rule.enabled || rule.prefix !== agentRunEventsLifecycleRule.prefix || !expiresAfterOneDay(rule.action)) {
    throw new Error(`Lifecycle rule ${rule.name} is not the enabled one-day ${agentRunEventsLifecycleRule.prefix} policy.`);
  }
  const conflicts = rules.filter((candidate) => candidate !== rule
    && candidate.enabled
    && isExpirationAction(candidate.action)
    && prefixesOverlap(candidate.prefix, agentRunEventsLifecycleRule.prefix));
  if (conflicts.length) {
    throw new Error(`Conflicting lifecycle rules overlap ${agentRunEventsLifecycleRule.prefix}: ${conflicts.map((candidate) => candidate.name).join(", ")}.`);
  }
  return rule;
}

export function assertNoAgentRunEventsLifecycleConflict(rules: R2LifecycleRule[]) {
  const named = rules.filter((rule) => rule.name === agentRunEventsLifecycleRule.name);
  if (named.length > 1) throw new Error(`Duplicate ${agentRunEventsLifecycleRule.name} lifecycle rules exist.`);
  if (named.length === 1) assertAgentRunEventsLifecyclePolicy(rules);
  const conflicts = rules.filter((rule) => rule.enabled
    && rule.name !== agentRunEventsLifecycleRule.name
    && isExpirationAction(rule.action)
    && prefixesOverlap(rule.prefix, agentRunEventsLifecycleRule.prefix));
  if (conflicts.length) {
    throw new Error(`Conflicting lifecycle rules overlap ${agentRunEventsLifecycleRule.prefix}: ${conflicts.map((rule) => rule.name).join(", ")}.`);
  }
}

export async function listR2LifecycleRules(bucket: string) {
  return parseR2LifecycleRules(await runWranglerLifecycle(["r2", "bucket", "lifecycle", "list", bucket]));
}

export async function runWranglerLifecycle(args: string[]) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  if (process.platform === "win32") {
    const result = await execFileAsync(command, ["wrangler", ...args], { maxBuffer: 1024 * 1024 });
    return result.stdout;
  }
  return await new Promise<string>((resolveRun, rejectRun) => {
    const child = spawn("script", ["-q", "/dev/null", command, "wrangler", ...args], {
      stdio: ["inherit", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    const collect = (target: Buffer[], chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > 1024 * 1024) {
        child.kill();
        rejectRun(new Error("Wrangler lifecycle output exceeded one MiB."));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", rejectRun);
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8");
      if (code === 0) resolveRun(output);
      else rejectRun(new Error(`Wrangler lifecycle command failed (${code ?? "signal"}): ${Buffer.concat(stderr).toString("utf8") || output}`));
    });
  });
}

function expiresAfterOneDay(action: string) {
  return /^expire objects after 1 day(?:s)?$/i.test(action.trim());
}

function isExpirationAction(action: string) {
  return /expire objects after/i.test(action);
}

function prefixesOverlap(left: string, right: string) {
  return left.startsWith(right) || right.startsWith(left);
}
