export function adminToken() {
  return process.env.LODESTA_ADMIN_TOKEN?.trim();
}

export function recoveryWatchdogToken() {
  return process.env.LODESTA_RECOVERY_WATCHDOG_TOKEN?.trim();
}

export function authRequired() {
  return process.env.NODE_ENV === "production" || process.env.LODESTA_REQUIRE_AUTH === "true";
}

export const platformAdminRole = "platform_admin";

type TrustedAuthUser = {
  app_metadata?: unknown;
};

export function hasPlatformAdminRole(user: TrustedAuthUser | undefined | null) {
  if (!user || !isRecord(user.app_metadata)) return false;
  const roles = user.app_metadata.lodesta_roles;
  return Array.isArray(roles) && roles.some((role) => role === platformAdminRole);
}

export function hasValidAdminToken(headers: { get(name: string): string | null }) {
  const expected = adminToken();
  if (!expected) return false;

  const authorization = headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const headerToken = headers.get("x-lodesta-admin-token");
  const provided = bearer ?? headerToken;

  return Boolean(provided && timingSafeEqual(provided, expected));
}

export function hasValidRecoveryWatchdogToken(headers: { get(name: string): string | null }) {
  const expected = recoveryWatchdogToken();
  const provided = bearerToken(headers);
  return Boolean(expected && provided && timingSafeEqual(provided, expected));
}

export function hasBearerToken(headers: { get(name: string): string | null }) {
  return Boolean(bearerToken(headers));
}

function bearerToken(headers: { get(name: string): string | null }) {
  return headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

function timingSafeEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
