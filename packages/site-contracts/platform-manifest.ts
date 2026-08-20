// Each hash is derived from the canonical behavioral descriptor for the
// component. Changing a descriptor is a clean contract replacement.
export const siteAuthoringPlatformIdentity = "site-authoring-platform@sha256:5b923f7d403ea7d49c8d42054e0af91390f7d399c583cb1bf79ade6d02fa88bf";
export const canonicalSiteAuthoringRuntimeSeriesId = "site-runtime-v4" as const;
export const siteSandboxApiIdentity = "site-sandbox-api@sha256:7ab8f1cdb4dc7ef49c81449a77178ed4d5ace537951d359350eba54050b8b85d";
export const siteSandboxStorageIdentity = "site-sandbox-storage@sha256:caec62e6aaa7ea4cc097ac859295a97cf4ac7a94695da54f16eebc089312f9a6";
export const siteSandboxDurableObjectIdentity = "site-sandbox-durable-object@sha256:f60c304d730f280207606d2decd14312c95b211f355dbf1ca2f829cbe2166784";
export const agentAuthoredArtifactIdentity = "agent-authored-artifact@sha256:49565a3bfd2348b4a3baa50be7641bccc4927a43d83b0222b4f262638509ff37";
// Checked-in release identity for the compiler scaffold, including platform capability CSS.
// The manifest generator fingerprints source explicitly; imports never derive deploy state.
export const siteToolchainIdentity = "lodesta-static-site-workspace@sha256:7f74a114d37d80f41955d0469a38cd2cbf4297b3e635f581e92e5cc0b316c857";
export const websiteManagerPromptIdentity = "website-manager@sha256:fbf163d754f290919f943ecbc4e5c22f432defa9dbdd823e7a15c73273171fe0";
export const factBindingPolicyIdentity = "fact-binding-validator@sha256:eae1e92ea3eb70818e6a83cedab318494809320bae142a60b3691f46cc0e3a0d";
export const siteVerificationPolicyIdentity = "site-verification-policy@sha256:8bf130012c8273f60c86d699062db13b663231f9e98fe1f9d952e7089f7f624b";
export const workspaceSourcePolicyIdentity = "workspace-source-policy@sha256:2f90904d1ada3eddf23e2c821b7c0841ee327d6b404de909e83f0ecfe9c79cab";

export const siteTechnicalReleasePolicy = {
  schemaVersion: 1,
  blockingPrefixes: ["capability.", "fact.", "identity."],
  blockingIds: [
    "html.runtime_count",
    "html.runtime_identity",
    "link.rendered",
    "route.response",
    "render.console",
    "render.page_error",
    "render.network",
    "render.broken_image",
    "render.escaped_sequence",
    "render.mobile_navigation",
    "render.mobile_navigation_trigger",
    "render.horizontal_overflow",
    "render.clipping_overlap",
    "render.text_clipping",
    "render.contrast",
    "render.browser_default_document",
    "functional.navigation_toggle",
    "functional.navigation_reachability",
    "functional.canonical_link",
    "functional.adjacent_duplicate_content",
    "functional.header_control_collision",
    "functional.aria_reference",
    "functional.fragment_target"
  ]
} as const;

// Updated only after the corresponding Cloudflare image is built and deployed.
export const sandboxImageDigest = "sha256:f80a45a2facb768601ccafd240add43053528dd201b8dc7e72bb240a2e453d2c" as const;

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
  apiIdentity: siteSandboxApiIdentity,
  storageIdentity: siteSandboxStorageIdentity,
  durableObjectIdentity: siteSandboxDurableObjectIdentity,
  artifactContractIdentity: agentAuthoredArtifactIdentity,
  toolchainIdentity: siteToolchainIdentity,
  sourcePolicyIdentity: workspaceSourcePolicyIdentity
} as const;
