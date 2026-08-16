import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  configuredRepositoryMode,
  hasHostedExecutionAuthority,
  hasHostedReleaseIdentity,
  type LodestaExecutionRole
} from "../packages/execution-environment";
import { SupabaseSitePlatformRepository } from "../packages/platform-data/repository";

const releaseSha = "a".repeat(40);
const operationsRepositorySource = await readFile("packages/platform-operations/repository.ts", "utf8");
assert.match(
  operationsRepositorySource,
  /claimNextWebsiteAssessmentJob[\s\S]*assertHostedExecutionAuthority\("site-authoring-worker", "claim_website_assessment_job"\)/,
  "The hosted website-assessment claim must be guarded by worker authority"
);
const complete = environment({ role: "release" });

assert.equal(hasHostedReleaseIdentity(complete), true);
assert.equal(hasHostedExecutionAuthority("release", complete), true);
assert.equal(hasHostedExecutionAuthority("site-authoring-worker", complete), false);

for (const missing of ["NODE_ENV", "LODESTA_RELEASE_GIT_SHA", "LODESTA_APP_ORIGIN", "LODESTA_EXECUTION_ROLE"] as const) {
  const candidate = { ...complete };
  delete candidate[missing];
  assert.equal(hasHostedExecutionAuthority("release", candidate), false, `${missing} must be required`);
}

assert.equal(hasHostedExecutionAuthority("release", environment({ role: "unknown" })), false);
assert.equal(hasHostedExecutionAuthority("release", environment({ role: "release", origin: "http://lodesta.test" })), false);
assert.equal(hasHostedExecutionAuthority("release", environment({ role: "release", origin: "https://localhost" })), false);
assert.equal(hasHostedExecutionAuthority("release", environment({ role: "release", sha: "short" })), false);

const web = environment({ role: "web" });
const worker = environment({ role: "site-authoring-worker" });
assert.equal(hasHostedExecutionAuthority("site-authoring-worker", web), false, "web must not claim runs");
assert.equal(hasHostedExecutionAuthority("release", web), false, "web must not mutate sandbox control");
assert.equal(hasHostedExecutionAuthority("site-authoring-worker", worker), true, "worker must be able to claim runs");
assert.equal(hasHostedExecutionAuthority("release", worker), false, "worker must not mutate sandbox control");
assert.equal(hasHostedExecutionAuthority("site-authoring-worker", complete), false, "release must not claim runs");

assert.equal(configuredRepositoryMode({} as NodeJS.ProcessEnv), "local");
assert.equal(configuredRepositoryMode({ LODESTA_REPOSITORY: "local", ...complete }), "local");
assert.equal(configuredRepositoryMode({ NODE_ENV: "development", LODESTA_REPOSITORY: "supabase" }), "supabase");
assert.equal(configuredRepositoryMode(complete), "supabase");
assert.equal(configuredRepositoryMode(environment({ role: "web", nodeEnv: "development" })), "local");
assert.throws(() => configuredRepositoryMode({ NODE_ENV: "development", LODESTA_REPOSITORY: "hosted" }), /invalid_lodesta_repository/);

const guardedRepository = new SupabaseSitePlatformRepository();
const guardedEnvironmentKeys = ["NODE_ENV", "LODESTA_RELEASE_GIT_SHA", "LODESTA_APP_ORIGIN", "LODESTA_EXECUTION_ROLE"] as const;
const priorEnvironment = Object.fromEntries(guardedEnvironmentKeys.map((key) => [key, process.env[key]]));
try {
  Object.assign(process.env, {
    NODE_ENV: "production",
    LODESTA_RELEASE_GIT_SHA: releaseSha,
    LODESTA_APP_ORIGIN: "https://lodesta.example",
    LODESTA_EXECUTION_ROLE: "web"
  });
  await assert.rejects(() => guardedRepository.claimNextAgentRun("forbidden-web"), /hosted_execution_authority_required:site-authoring-worker/);
  await assert.rejects(() => guardedRepository.saveSandboxControl({} as never), /hosted_execution_authority_required:release/);
  process.env.LODESTA_EXECUTION_ROLE = "site-authoring-worker";
  await assert.rejects(() => guardedRepository.saveSandboxDeployment({} as never), /hosted_execution_authority_required:release/);
  process.env.LODESTA_EXECUTION_ROLE = "release";
  await assert.rejects(() => guardedRepository.claimAgentRun("forbidden-release"), /hosted_execution_authority_required:site-authoring-worker/);
} finally {
  for (const key of guardedEnvironmentKeys) {
    const value = priorEnvironment[key];
    if (value === undefined) delete process.env[key];
    else Reflect.set(process.env, key, value);
  }
}

process.stdout.write("execution authority verified\n");

function environment(input: {
  role: LodestaExecutionRole | "unknown";
  nodeEnv?: "development" | "production" | "test";
  sha?: string;
  origin?: string;
}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: input.nodeEnv ?? "production",
    LODESTA_RELEASE_GIT_SHA: input.sha ?? releaseSha,
    LODESTA_APP_ORIGIN: input.origin ?? "https://lodesta.example",
    LODESTA_EXECUTION_ROLE: input.role
  };
}
