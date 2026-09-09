// Each hash is derived from the canonical behavioral descriptor for the
// component. Changing a descriptor is a clean contract replacement.
// Descriptor: site-authoring-platform:source-backed-service-scope:explicit-narrative-service-areas:cdn-visual-candidates:functional-header-evidence:explicit-missed-logo-adoption:2026-09-09
export const siteAuthoringPlatformIdentity = "site-authoring-platform@sha256:e54c3fbae602edbae77c3a841668a8cad0cf19e422e7e8d8c8fb1f3cb7f1e7b5";
export const canonicalSiteAuthoringRuntimeSeriesId = "site-runtime-v4" as const;
export const siteSandboxApiIdentity = "site-sandbox-api@sha256:7ab8f1cdb4dc7ef49c81449a77178ed4d5ace537951d359350eba54050b8b85d";
export const siteSandboxStorageIdentity = "site-sandbox-storage@sha256:caec62e6aaa7ea4cc097ac859295a97cf4ac7a94695da54f16eebc089312f9a6";
export const siteSandboxDurableObjectIdentity = "site-sandbox-durable-object@sha256:f60c304d730f280207606d2decd14312c95b211f355dbf1ca2f829cbe2166784";
export const agentAuthoredArtifactIdentity = "agent-authored-artifact@sha256:49565a3bfd2348b4a3baa50be7641bccc4927a43d83b0222b4f262638509ff37";
// Checked-in release identity for the compiler scaffold, including platform capability CSS.
// The manifest generator fingerprints source explicitly; imports never derive deploy state.
export const siteToolchainIdentity = "lodesta-static-site-workspace@sha256:4035a9c30f9143fa4d57ad4ef012df70c88321c2b6da25d9096b58ee96d26a5c";
// Descriptor: website-manager:truthful-source-media-context:guarded-missed-logo-adoption:2026-09-09
export const websiteManagerPromptIdentity = "website-manager@sha256:7d71b07c6f1dffc5bea77e13cbafc007de0414a2af450ca517c75382cb0144e1";
// Descriptor: fact-binding-validator:exact-markers-and-bindings:advisory-prose-evidence:2026-09-05
export const factBindingPolicyIdentity = "fact-binding-validator@sha256:e560da37c4418c025b62803388a62cf34a50358b0a6c7ec64436ef6552e71eaa";
// Descriptor: site-verification-policy:controlled-panel-navigation:advisory-prose-evidence:owner-approved-documents:no-header-line-count-advisory:2026-09-08
export const siteVerificationPolicyIdentity = "site-verification-policy@sha256:09a3fae35586160cb160d8823b56375c8e0eff372453ec7b4de8fc06ea487415";
export const workspaceSourcePolicyIdentity = "workspace-source-policy@sha256:a9dc99a379ac4ccb9bd4a590bda1b4864ac05827a8d2e560fe06f46706974cab";

export const siteTechnicalReleasePolicy = {
  schemaVersion: 1,
  blockingPrefixes: [
    "capability.",
    "fact.",
    "identity.",
    "accessibility.axe.critical.",
    "accessibility.axe.serious."
  ],
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
    "render.missing_glyph",
    "render.mobile_navigation",
    "render.mobile_navigation_trigger",
    "render.horizontal_overflow",
    "render.clipping_overlap",
    "render.text_clipping",
    "render.contrast",
    "render.browser_default_document",
    "functional.navigation_toggle",
    "functional.navigation_reachability",
    "functional.noninteractive_control",
    "functional.canonical_link",
    "functional.adjacent_duplicate_content",
    "functional.header_control_collision",
    "functional.mobile_heading_measure",
    "functional.text_measure",
    "functional.aria_reference",
    "functional.fragment_target"
  ]
} as const;

// Updated only after the corresponding Cloudflare image is built and deployed.
export const sandboxImageDigest = "sha256:5f127c8891290f7d811ba768fb4438fdeaac6666fca85a1aa04fbad1c6560d36" as const;

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
