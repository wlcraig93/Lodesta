export function adminToken() {
  return process.env.LODESTA_ADMIN_TOKEN?.trim();
}

export function authRequired() {
  return process.env.NODE_ENV === "production" || process.env.LODESTA_REQUIRE_AUTH === "true";
}

export function adminEmails() {
  return (process.env.LODESTA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | undefined | null) {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
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
