export const agenticSitePlatformVersion = "agentic-site-platform-v1.20";
export const siteToolchainVersion = "lodesta-static-site-workspace-v1.8";
export const websiteManagerPromptVersion = "website-manager-v3.0";
export const artifactClaimPolicyVersion = "artifact-claim-validator-v1.3";

// Updated only after the corresponding Cloudflare image is built and deployed.
export const sandboxImageDigest = "sha256:a2e4e0aadb938397dfddded68f08b094d25505df4359af0568103caa82a7c30d" as const;

export const sitePlatformVersionManifest = {
  platform: agenticSitePlatformVersion,
  toolchain: siteToolchainVersion,
  managerPrompt: websiteManagerPromptVersion,
  claimPolicy: artifactClaimPolicyVersion,
  sandboxImageDigest
} as const;
