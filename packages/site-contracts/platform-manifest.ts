// Each hash is derived from the canonical behavioral descriptor for the
// component. Changing a descriptor is a clean contract replacement.
// Descriptor: site-authoring-platform:observed-name-authority:explicit-missed-logo-adoption:question-scoped-metered-research:explicit-line-edit-semantics:scope-preserving-type-advisory:approved-document-mismatch-context:pending-navigation-resource-evidence:explicit-search-excerpts:2026-09-10
export const siteAuthoringPlatformIdentity = "site-authoring-platform@sha256:d5a5bd1b585539c2a5112d0a1b80c45396dfcced0f3c3db54c42595e48a4680c";
export const canonicalSiteAuthoringRuntimeSeriesId = "site-runtime-v4" as const;
export const siteSandboxApiIdentity = "site-sandbox-api@sha256:7ab8f1cdb4dc7ef49c81449a77178ed4d5ace537951d359350eba54050b8b85d";
export const siteSandboxStorageIdentity = "site-sandbox-storage@sha256:caec62e6aaa7ea4cc097ac859295a97cf4ac7a94695da54f16eebc089312f9a6";
export const siteSandboxDurableObjectIdentity = "site-sandbox-durable-object@sha256:f60c304d730f280207606d2decd14312c95b211f355dbf1ca2f829cbe2166784";
export const agentAuthoredArtifactIdentity = "agent-authored-artifact@sha256:49565a3bfd2348b4a3baa50be7641bccc4927a43d83b0222b4f262638509ff37";
// Checked-in release identity for the compiler scaffold, including platform capability CSS.
// The manifest generator fingerprints source explicitly; imports never derive deploy state.
export const siteToolchainIdentity = "lodesta-static-site-workspace@sha256:e9d0d1aa18403d8bc836c5178f6d32265cf1a1b112ffc79f60b50f1ff4b3dc9b";
// Hash of the actual authoring system prompt. Tool/context changes are carried
// by the platform identity; they do not redefine unchanged system-prompt bytes.
export const websiteManagerPromptIdentity = "website-manager@sha256:44661e8fa2ca98c76c43c46b73607ed7461531d4bb8a75c2e5123128cce3c3c4";
// Descriptor: fact-binding-validator:exact-markers-and-bindings:advisory-prose-evidence:2026-09-05
export const factBindingPolicyIdentity = "fact-binding-validator@sha256:e560da37c4418c025b62803388a62cf34a50358b0a6c7ec64436ef6552e71eaa";
// Descriptor: site-verification-policy:controlled-panel-navigation:advisory-prose-evidence:owner-approved-documents:no-header-line-count-advisory:qualified-body-text-advisory:approved-document-mismatch-context:pending-navigation-resource-evidence:2026-09-09
export const siteVerificationPolicyIdentity = "site-verification-policy@sha256:03891266f4f69958c583a2afcd728b77fdf75caf0b4ea0076ea996fe26306d85";
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
