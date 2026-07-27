// Each hash is derived from the canonical behavioral descriptor for the
// component. Changing a descriptor is a clean contract replacement.
export const siteAuthoringPlatformIdentity = "site-authoring-platform@sha256:16a035d85b88b5174489d5848bcb05d45cdc0547fdb3ad54b5d698aa566b380e";
export const agentAuthoredArtifactIdentity = "agent-authored-artifact@sha256:82761c88ba2c9b8734972bdc6bd124f373d23048df951d55b2aa0e0e5b4e4900";
export const siteToolchainIdentity = "lodesta-static-site-workspace@sha256:22633a9bb1eca2e077ef2e7108727a6af7041e1df730e3256994ad8e4c4c9b86";
export const websiteManagerPromptIdentity = "website-manager@sha256:6d3e752c2295f436a6000c3ca5c7f2dea43068c38254797e9470206dda9e0d1f";
export const factBindingPolicyIdentity = "fact-binding-validator@sha256:eae1e92ea3eb70818e6a83cedab318494809320bae142a60b3691f46cc0e3a0d";
export const siteVerificationPolicyIdentity = "site-verification-policy@sha256:c10bdab7cf9b0a49a47867bdb4617d8c5ba3a2b5504db64049daee0482bed869";
export const workspaceSourcePolicyIdentity = "workspace-source-policy@sha256:3ed4f0b9404865b36734dbc56edd7c697a0ffb919a79c086aaef1a2848acaa79";

export const siteTechnicalReleasePolicy = {
  schemaVersion: 1,
  blockingPrefixes: ["capability."],
  blockingIds: [
    "html.runtime_count",
    "html.runtime_identity",
    "link.rendered",
    "route.response",
    "render.console",
    "render.page_error",
    "render.network",
    "render.broken_image"
  ]
} as const;

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
