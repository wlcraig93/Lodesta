import type { LeadSubmission } from "./models";

export type PublicLeadSubmission = Omit<LeadSubmission, "ipHash" | "visitorId">;

export function publicLeadSubmission(lead: LeadSubmission): PublicLeadSubmission {
  const { ipHash: _ipHash, visitorId: _visitorId, ...publicLead } = lead;
  return publicLead;
}
