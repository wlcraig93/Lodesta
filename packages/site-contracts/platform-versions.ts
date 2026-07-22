export const siteAuthoringPlatformVersion = "site-authoring-platform-v1.21";
export const siteToolchainVersion = "lodesta-static-site-workspace-v1.9";
export const websiteManagerPromptVersion = "website-manager-simple-v1";
export const artifactClaimPolicyVersion = "artifact-claim-validator-v1.3";
export const siteVerificationPolicyVersion = "site-verification-policy-v2";

// Updated only after the corresponding Cloudflare image is built and deployed.
export const sandboxImageDigest = "sha256:cfe3a3df7dba77d02b08346299909e7ff69f213da028d3e5d613cd48588f7d22" as const;

export const sitePlatformVersionManifest = {
  platform: siteAuthoringPlatformVersion,
  toolchain: siteToolchainVersion,
  managerPrompt: websiteManagerPromptVersion,
  claimPolicy: artifactClaimPolicyVersion,
  verificationPolicy: siteVerificationPolicyVersion,
  sandboxImageDigest
} as const;
