export const agenticSitePlatformVersion = "agentic-site-platform-v1.13";
export const siteToolchainVersion = "lodesta-static-site-workspace-v1.4";
export const websiteManagerPromptVersion = "website-manager-v2.1";
export const artifactClaimPolicyVersion = "artifact-claim-validator-v1.2";

// Updated only after the corresponding Cloudflare image is built and deployed.
export const sandboxImageDigest = "sha256:6967ab68b50dc14fd575972932c61e788358bc347bef0498935440ce1a5a6e2a" as const;

export const sitePlatformVersionManifest = {
  platform: agenticSitePlatformVersion,
  toolchain: siteToolchainVersion,
  managerPrompt: websiteManagerPromptVersion,
  claimPolicy: artifactClaimPolicyVersion,
  sandboxImageDigest
} as const;
