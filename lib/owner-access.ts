/**
 * Owner access control (Phase 1.5): claim verification levels and the audit
 * trail. Honest naming: phone verification proves ACCESS to the business's
 * listed number, not ownership. Higher-risk actions require higher levels, so
 * a front-desk employee (or a competitor with temporary call access) cannot
 * repoint a domain or export/delete data.
 */

export type ClaimVerificationLevel = "contact_verified" | "owner_verified" | "operator_verified";

export type OwnerActionKey =
  | "confirm_fact"
  | "confirm_service"
  | "toggle_service"
  | "update_hours"
  | "update_phone"
  | "attest_media"
  | "approve_publish_preview"
  | "change_domain"
  | "export_data"
  | "delete_account";

const levelRank: Record<ClaimVerificationLevel, number> = {
  contact_verified: 1,
  owner_verified: 2,
  operator_verified: 3
};

/** Minimum verification level per owner action. */
export const requiredLevelForAction: Record<OwnerActionKey, ClaimVerificationLevel> = {
  confirm_fact: "contact_verified",
  confirm_service: "contact_verified",
  toggle_service: "contact_verified",
  update_hours: "contact_verified",
  // Changing the verified channel needs more than access to the channel itself.
  update_phone: "owner_verified",
  attest_media: "contact_verified",
  approve_publish_preview: "contact_verified",
  change_domain: "owner_verified",
  export_data: "owner_verified",
  delete_account: "owner_verified"
};

export function actionAllowedAtLevel(action: OwnerActionKey, level: ClaimVerificationLevel): boolean {
  return levelRank[level] >= levelRank[requiredLevelForAction[action]];
}

export type OwnerAuditEntry = {
  id: string;
  businessId: string;
  siteId?: string;
  actor: string;
  actorRole: "owner" | "operator" | "system";
  action: string;
  fieldKey?: string;
  priorValue?: unknown;
  newValue?: unknown;
  createdAt: string;
};

export function buildAuditEntry(input: Omit<OwnerAuditEntry, "id" | "createdAt">): OwnerAuditEntry {
  const createdAt = new Date().toISOString();
  return {
    ...input,
    id: `audit_${input.businessId}_${createdAt.replace(/[^0-9]/g, "")}_${Math.abs(hashCode(`${input.action}${input.fieldKey ?? ""}${createdAt}`)).toString(36)}`,
    createdAt
  };
}

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}
