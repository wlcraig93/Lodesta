export type OwnerIdentity = {
  displayName: string;
  email?: string;
};

type IdentityUser = {
  email?: string | null;
  user_metadata?: unknown;
} | null | undefined;

const metadataKeys = ["display_name", "full_name", "name"] as const;

export function resolveOwnerIdentity(user: IdentityUser, fallback = "Account"): OwnerIdentity {
  const metadata = record(user?.user_metadata);
  const email = cleanEmail(user?.email);
  for (const key of metadataKeys) {
    const displayName = sanitizeDisplayName(metadata?.[key]);
    if (displayName) return { displayName, ...(email ? { email } : {}) };
  }
  const emailName = humanizeEmailLocalPart(email);
  return {
    displayName: emailName ?? sanitizeDisplayName(fallback) ?? "Account",
    ...(email ? { email } : {})
  };
}

export function sanitizeDisplayName(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const clamped = Array.from(normalized).slice(0, 80).join("").trim();
  return clamped.length >= 2 ? clamped : undefined;
}

function humanizeEmailLocalPart(email?: string) {
  if (!email) return undefined;
  const local = email.split("@")[0] ?? "";
  const words = local
    .replace(/[._+-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return sanitizeDisplayName(words.join(" "));
}

function cleanEmail(value: unknown) {
  if (typeof value !== "string") return undefined;
  const email = value.trim();
  return email && email.length <= 320 ? email : undefined;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
