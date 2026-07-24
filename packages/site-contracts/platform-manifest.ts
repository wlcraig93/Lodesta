// Each hash is derived from the canonical behavioral descriptor for the
// component. Changing a descriptor is a clean contract replacement.
export const siteAuthoringPlatformIdentity = "site-authoring-platform@sha256:8571c0fcbca563287294aa2e3f7e5c8fa7356e248588d968157527f74fefaf41";
export const agentAuthoredArtifactIdentity = "agent-authored-artifact@sha256:82761c88ba2c9b8734972bdc6bd124f373d23048df951d55b2aa0e0e5b4e4900";
export const siteToolchainIdentity = "lodesta-static-site-workspace@sha256:1282566c7ec4001160c29797e1b0a9fb1d932ae5275556aa4e3a948c60ddb96a";
export const websiteManagerPromptIdentity = "website-manager@sha256:a84cfd8a173e48bd6190e5123c76877e9e6e7cef7b411300d7963049fb1ef1b4";
export const factBindingPolicyIdentity = "fact-binding-validator@sha256:4a5112fc02a1edf76b5eb4f47b9cb9e8d4da7c6c9f68546991b51d3f93defa09";
export const siteVerificationPolicyIdentity = "site-verification-policy@sha256:49d1944f402262b2ac6bd92159426622cb0f1a0dbf98f5a6221f2c78a9cc1909";
export const workspaceSourcePolicyIdentity = "workspace-source-policy@sha256:d05531a635cec1d6a4f7f51c4d9d18e0c9992b4329747945592600c8fe4079f6";

// Updated only after the corresponding Cloudflare image is built and deployed.
export const sandboxImageDigest = "sha256:aaada666acfb57c1804040015a39217d0963fb0cae46e23fa406999c1ef4470f" as const;

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
