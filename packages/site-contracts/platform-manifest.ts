// Each hash is derived from the canonical behavioral descriptor for the
// component. Changing a descriptor is a clean contract replacement.
export const siteAuthoringPlatformIdentity = "site-authoring-platform@sha256:5f424c094b7d57e2b9a170feb36fcad25155d08a3b9c01a59f4ddfa964ea89ad";
export const agentAuthoredArtifactIdentity = "agent-authored-artifact@sha256:82761c88ba2c9b8734972bdc6bd124f373d23048df951d55b2aa0e0e5b4e4900";
export const siteToolchainIdentity = "lodesta-static-site-workspace@sha256:6be251de0bb93f72982fd73e6484b1cf509cebe4b2ed23d136ef343963ccfa14";
export const websiteManagerPromptIdentity = "website-manager@sha256:ceec1733fa1de8164b29c2ceb45ddb7556846e67dd155b97f9e6b338d0496f0b";
export const factBindingPolicyIdentity = "fact-binding-validator@sha256:e1b7558a5b77b80e978bcea2353703e0d6bf168487fcf3979ea3f72b8080179d";
export const siteVerificationPolicyIdentity = "site-verification-policy@sha256:9fd89960aa07ee4d38ad95dfe3e96201b993770dc92f9bc03072a67e065d407f";
export const workspaceSourcePolicyIdentity = "workspace-source-policy@sha256:d05531a635cec1d6a4f7f51c4d9d18e0c9992b4329747945592600c8fe4079f6";

// Updated only after the corresponding Cloudflare image is built and deployed.
export const sandboxImageDigest = "sha256:467b060fe06d0f5e81e03f3eeb94573cfa92cb4047274a2c8e58ae62d66282b7" as const;

export const sitePlatformManifest = {
  platform: siteAuthoringPlatformIdentity,
  artifactContract: agentAuthoredArtifactIdentity,
  toolchain: siteToolchainIdentity,
  managerPrompt: websiteManagerPromptIdentity,
  factBindingPolicy: factBindingPolicyIdentity,
  verificationPolicy: siteVerificationPolicyIdentity,
  sourcePolicy: workspaceSourcePolicyIdentity,
  sandboxImageDigest
} as const;

export const expectedSiteSandboxManifest = {
  kind: "site-sandbox-manifest",
  artifactContractIdentity: agentAuthoredArtifactIdentity,
  toolchainIdentity: siteToolchainIdentity,
  sourcePolicyIdentity: workspaceSourcePolicyIdentity
} as const;
