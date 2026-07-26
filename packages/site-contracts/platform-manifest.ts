// Each hash is derived from the canonical behavioral descriptor for the
// component. Changing a descriptor is a clean contract replacement.
export const siteAuthoringPlatformIdentity = "site-authoring-platform@sha256:8571c0fcbca563287294aa2e3f7e5c8fa7356e248588d968157527f74fefaf41";
export const agentAuthoredArtifactIdentity = "agent-authored-artifact@sha256:82761c88ba2c9b8734972bdc6bd124f373d23048df951d55b2aa0e0e5b4e4900";
export const siteToolchainIdentity = "lodesta-static-site-workspace@sha256:1a991df3af2a6a50ddce87cdb80e825ae76314759c3f1210d253c599f6a2f227";
export const websiteManagerPromptIdentity = "website-manager@sha256:25c8dc5d11b2796743d3f132fe7e316d205ec3abff99f6f068414d6677ed114b";
export const factBindingPolicyIdentity = "fact-binding-validator@sha256:eae1e92ea3eb70818e6a83cedab318494809320bae142a60b3691f46cc0e3a0d";
export const siteVerificationPolicyIdentity = "site-verification-policy@sha256:d5134f3d932fc3f1a245b97040a1c55ecaa32eba997c8e2e127c6a216afcca29";
export const workspaceSourcePolicyIdentity = "workspace-source-policy@sha256:625c6f2f08e96b5d0fea686bbbbcbee622c6025e97826bb150bbd14b06617a6f";

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
