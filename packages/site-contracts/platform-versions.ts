export const siteAuthoringPlatformVersion = "site-authoring-platform-v1.22";
export const agentAuthoredArtifactVersion = "agent-authored-artifact-v2";
export const siteToolchainVersion = "lodesta-static-site-workspace-v1.10";
export const websiteManagerPromptVersion = "website-manager-simple-v2";
export const factDeclarationPolicyVersion = "fact-declaration-validator-v1";
export const siteVerificationPolicyVersion = "site-verification-policy-v2";
export const workspaceSourcePolicyVersion = "workspace-source-policy-v5";

// Updated only after the corresponding Cloudflare image is built and deployed.
export const sandboxImageDigest = "sha256:4bcb177f2467dffdbd03ff6ac60e8053b0b636dcd10792ac084271fd53feaa11" as const;

export const sitePlatformVersionManifest = {
  platform: siteAuthoringPlatformVersion,
  artifactContract: agentAuthoredArtifactVersion,
  toolchain: siteToolchainVersion,
  managerPrompt: websiteManagerPromptVersion,
  factDeclarationPolicy: factDeclarationPolicyVersion,
  verificationPolicy: siteVerificationPolicyVersion,
  sourcePolicy: workspaceSourcePolicyVersion,
  sandboxImageDigest
} as const;

export const expectedSiteSandboxManifest = {
  schemaVersion: "site-sandbox-manifest-v1",
  artifactContractVersion: agentAuthoredArtifactVersion,
  toolchainVersion: siteToolchainVersion,
  sourcePolicyVersion: workspaceSourcePolicyVersion
} as const;
