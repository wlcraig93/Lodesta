// Each hash is derived from the canonical behavioral descriptor for the
// component. Changing a descriptor is a clean contract replacement.
// Descriptor: site-authoring-platform:observed-name-authority:explicit-missed-logo-adoption:question-scoped-metered-research:explicit-line-edit-semantics:scope-preserving-type-advisory:approved-document-mismatch-context:pending-navigation-resource-evidence:explicit-search-excerpts:intrinsic-media-dimensions:no-thumbnail-enlargement:image-edit-api-fidelity:image-tool-flare:optional-source-first-image-authoring:official-logo-image-boundary:retained-image-ancestry:durable-provisional-media:failure-only-sandbox-diagnostics:atomic-source-only-finalization:initial-curated-image-context:explicit-quote-omissions:visible-form-schema-status:architecture-provider-error-classification:author-selected-inspection-focus:corroborated-homepage-name:structural-service-routes:joined-unit-address:eligible-research-geography:page-identity-not-placeholder-components:meaningful-source-citations:self-contained-source-svg-logo:camelcase-source-asset-signals:google-profile-url-disposition:retained-home-link-logo-selection:all-attributed-direct-quote-fidelity:context-bound-image-attribution:structured-preview-resource-filter:business-neutral-digest:source-photo-preparation-reader:source-heading-section-excerpts:source-photo-delivery:explicit-asset-preview-availability:service-decision-evidence-mapping:adjacent-retained-media-page-provenance:tagged-first-party-sensitive-content:first-party-media-hosts:2026-09-24
export const siteAuthoringPlatformIdentity = "site-authoring-platform@sha256:56e7292fb5f5639c78d350ea38f5e74bbdcaaa6661de438d19e0c50868328d4c";
export const canonicalSiteAuthoringRuntimeSeriesId = "site-runtime-v4" as const;
export const siteSandboxApiIdentity = "site-sandbox-api@sha256:7ab8f1cdb4dc7ef49c81449a77178ed4d5ace537951d359350eba54050b8b85d";
export const siteSandboxStorageIdentity = "site-sandbox-storage@sha256:caec62e6aaa7ea4cc097ac859295a97cf4ac7a94695da54f16eebc089312f9a6";
export const siteSandboxDurableObjectIdentity = "site-sandbox-durable-object@sha256:f60c304d730f280207606d2decd14312c95b211f355dbf1ca2f829cbe2166784";
export const agentAuthoredArtifactIdentity = "agent-authored-artifact@sha256:49565a3bfd2348b4a3baa50be7641bccc4927a43d83b0222b4f262638509ff37";
// Checked-in release identity for the compiler scaffold, including platform capability CSS.
// The manifest generator fingerprints source explicitly; imports never derive deploy state.
export const siteToolchainIdentity = "lodesta-static-site-workspace@sha256:5aa7181a46a32a95043edd139bcef4a3eb93d48c314180949950210cee30e304";
// Hash of the actual authoring system prompt. Tool/context changes are carried
// by the platform identity; they do not redefine unchanged system-prompt bytes.
export const websiteManagerPromptIdentity = "website-manager@sha256:ca3b2b5018747de7ff36e0a0b9efd6cb243e496a0893035144a5ca16e00fce88";
// Descriptor: fact-binding-validator:exact-markers-and-bindings:advisory-prose-evidence:first-party-verbatim-sentence-markers:first-party-contact-markers:advisory-location-words:2026-09-24
export const factBindingPolicyIdentity = "fact-binding-validator@sha256:2e5fc2ceb319ceefde012cb00661b545c0a988a3c357337cda545f3ef5cf4430";
// Descriptor: site-verification-policy:controlled-panel-navigation:advisory-prose-evidence:owner-approved-documents:no-header-line-count-advisory:qualified-body-text-advisory:approved-document-mismatch-context:pending-navigation-resource-evidence:default-link-styling-required-for-cta-loss-signal:explicit-empty-main-functional-failure:advisory-pseudo-surface-paint:release-severity-inspection:advisory-slug-mismatch:advisory-missing-glyph:first-party-outbound-links:2026-09-24
export const siteVerificationPolicyIdentity = "site-verification-policy@sha256:7a86b8a0e51768218421fdf8933ef159b9586c8a2b8d0e215463f6446ca41840";
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
    "html.empty_main",
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
    "render.heading_word_break",
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
