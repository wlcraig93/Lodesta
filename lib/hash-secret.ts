import { createHmac } from "node:crypto";

const developmentHashSecret = "lodesta-development-hash-secret";

export function hasConfiguredHashSecret() {
  return Boolean(process.env.LODESTA_HASH_SECRET);
}

export function usesDevelopmentHashSecret() {
  return !hasConfiguredHashSecret() && process.env.NODE_ENV !== "production";
}

export function hashSecret() {
  const configured = process.env.LODESTA_HASH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("LODESTA_HASH_SECRET is required in production.");
  }
  return developmentHashSecret;
}

export function hmacSha256Hex(message: string, input?: { secret?: string }) {
  return createHmac("sha256", input?.secret ?? hashSecret()).update(message).digest("hex");
}
