import { workspaceSourcePolicyIdentity } from "@/packages/site-agent";
import {
  siteToolchainIdentity,
  siteVerificationPolicyIdentity,
  siteAgentRunSchema
} from "@/packages/site-contracts";
import { sitePlatformRepository, type SitePlatformRepository } from "@/packages/platform-data";
import { configuredSiteSandboxImageDigest } from "@/packages/site-sandbox";
import {
  externalAuthoringExecutionSchema,
  type AuthoringExecutionBundle,
  type ExternalAuthoringExecution
} from "./contracts";
import { externalAuthoringRepository, type ExternalAuthoringRepository } from "./repository";

export const platformVersionMismatchOwnerReason =
  "Lodesta’s authoring platform changed while this work was paused. Your website was not changed. Wait for the update to finish, then start a new request instead of retrying this run.";

export function externalAuthoringBundleMatchesRuntime(
  bundle: AuthoringExecutionBundle,
  environment: NodeJS.ProcessEnv = process.env
) {
  return bundle.sourcePolicyVersion === workspaceSourcePolicyIdentity
    && bundle.verificationPolicyVersion === siteVerificationPolicyIdentity
    && bundle.toolchainVersion === siteToolchainIdentity
    && bundle.sandboxImageDigest === configuredSiteSandboxImageDigest(environment);
}

export async function failExternalPlatformVersionMismatch(input: {
  execution: ExternalAuthoringExecution;
  claimId?: string;
  externalRepository?: ExternalAuthoringRepository;
  platformRepository?: SitePlatformRepository;
}) {
  if (["completed", "failed", "cancelled"].includes(input.execution.status)) return;
  const externalRepository = input.externalRepository ?? externalAuthoringRepository;
  const platformRepository = input.platformRepository ?? sitePlatformRepository;
  const now = new Date().toISOString();
  if (input.claimId) await externalRepository.fenceClaim(input.claimId, now);
  await externalRepository.saveExecution(externalAuthoringExecutionSchema.parse({
    ...input.execution,
    status: "failed",
    currentOperationId: undefined,
    completedAt: now,
    lastActivityAt: now,
    updatedAt: now
  }));
  const run = await platformRepository.getAgentRun(input.execution.runId);
  if (!run || ["succeeded", "failed", "cancelled"].includes(run.status)) return;
  await platformRepository.saveAgentRun(siteAgentRunSchema.parse({
    ...run,
    status: "failed",
    stage: "failed",
    failureCode: "platform_version_mismatch",
    failureCategory: "platform",
    retryableByOwner: false,
    failureReason: platformVersionMismatchOwnerReason,
    completedAt: now
  }));
}

export async function assertExternalAuthoringBundleCurrent(input: {
  execution: ExternalAuthoringExecution;
  bundle: AuthoringExecutionBundle;
  claimId?: string;
  publicBuildInputHash?: string;
  externalRepository?: ExternalAuthoringRepository;
  platformRepository?: SitePlatformRepository;
}) {
  const matchesInput = input.publicBuildInputHash === undefined
    || input.publicBuildInputHash === input.bundle.publicBuildInputHash;
  if (matchesInput && externalAuthoringBundleMatchesRuntime(input.bundle)) return;
  await failExternalPlatformVersionMismatch({
    execution: input.execution,
    claimId: input.claimId,
    externalRepository: input.externalRepository,
    platformRepository: input.platformRepository
  });
  throw new Error("platform_version_mismatch");
}
