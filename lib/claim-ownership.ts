export type ClaimOwnerResolution =
  | { ok: true; ownerUserId?: string; ownerEmail: string }
  | { ok: false; error: string };

export function resolveClaimOwner(input: {
  authUser?: { id?: string | null; email?: string | null } | null;
  requestedOwnerEmail?: string | null;
}): ClaimOwnerResolution {
  const ownerUserId = clean(input.authUser?.id);
  const authEmail = clean(input.authUser?.email)?.toLowerCase();
  const requestedEmail = clean(input.requestedOwnerEmail)?.toLowerCase();

  if (ownerUserId && authEmail && requestedEmail && requestedEmail !== authEmail) {
    return { ok: false, error: "Authenticated claims must use the signed-in owner email." };
  }

  const ownerEmail = authEmail ?? requestedEmail;
  if (!ownerEmail) {
    return { ok: false, error: "Owner email is required to claim a site." };
  }

  return { ok: true, ownerUserId, ownerEmail };
}

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
