import type { OutboundCampaign, OutboundEvent, OutboundProspect, OutboundSummary, Vertical } from "./models";

export type CreateOutboundCampaignInput = {
  name: string;
  channel?: OutboundCampaign["channel"];
  status?: OutboundCampaign["status"];
  metadata?: Record<string, string | number | boolean>;
};

export type UpsertOutboundProspectInput = {
  id?: string;
  campaignId: string;
  siteId?: string;
  businessName: string;
  vertical?: Vertical;
  sourceUrl?: string;
  previewToken?: string;
  mailingCode?: string;
  status?: OutboundProspect["status"];
  metadata?: Record<string, string | number | boolean>;
};

export type RecordOutboundEventInput = {
  campaignId: string;
  prospectId?: string;
  siteId?: string;
  type: OutboundEvent["type"];
  value?: number;
  metadata?: Record<string, string | number | boolean>;
  occurredAt?: string;
};

export function newOutboundCampaign(input: CreateOutboundCampaignInput): OutboundCampaign {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    channel: input.channel ?? "direct_mail",
    status: input.status ?? "draft",
    createdAt: now,
    startedAt: input.status === "running" ? now : undefined,
    metadata: cleanMetadata(input.metadata)
  };
}

export function newOutboundProspect(input: UpsertOutboundProspectInput): OutboundProspect {
  const now = new Date().toISOString();
  return {
    id: input.id ?? crypto.randomUUID(),
    campaignId: input.campaignId,
    siteId: input.siteId,
    businessName: input.businessName.trim(),
    vertical: input.vertical,
    sourceUrl: input.sourceUrl,
    previewToken: input.previewToken,
    mailingCode: input.mailingCode,
    status: input.status ?? "queued",
    createdAt: now,
    metadata: cleanMetadata(input.metadata)
  };
}

export function newOutboundEvent(input: RecordOutboundEventInput): OutboundEvent {
  return {
    id: crypto.randomUUID(),
    campaignId: input.campaignId,
    prospectId: input.prospectId,
    siteId: input.siteId,
    type: input.type,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    value: input.value,
    metadata: cleanMetadata(input.metadata)
  };
}

export function applyOutboundEventToProspect(prospect: OutboundProspect, event: OutboundEvent) {
  const occurredAt = event.occurredAt;
  if (event.siteId && !prospect.siteId) prospect.siteId = event.siteId;
  if (event.type === "mailer_sent") {
    prospect.status = statusAfter(prospect.status, "mailed");
    prospect.mailedAt ??= occurredAt;
  }
  if (event.type === "preview_viewed") {
    prospect.status = statusAfter(prospect.status, "preview_viewed");
    prospect.firstPreviewViewedAt ??= occurredAt;
  }
  if (event.type === "claim_started") {
    prospect.status = statusAfter(prospect.status, "claim_started");
    prospect.claimStartedAt ??= occurredAt;
  }
  if (event.type === "claim_completed") {
    prospect.status = statusAfter(prospect.status, "claimed");
    prospect.claimedAt ??= occurredAt;
  }
  if (event.type === "published") {
    prospect.status = statusAfter(prospect.status, "published");
    prospect.publishedAt ??= occurredAt;
  }
  if (event.type === "disqualified") {
    prospect.status = "disqualified";
    prospect.disqualifiedAt ??= occurredAt;
  }
}

export function summarizeOutbound(
  campaigns: OutboundCampaign[],
  prospects: OutboundProspect[],
  events: OutboundEvent[],
  campaignId?: string
): OutboundSummary {
  const scopedCampaigns = campaignId ? campaigns.filter((campaign) => campaign.id === campaignId) : campaigns;
  const scopedProspects = prospects.filter((prospect) => !campaignId || prospect.campaignId === campaignId);
  const scopedEvents = events.filter((event) => !campaignId || event.campaignId === campaignId);
  const mailed = scopedProspects.filter((prospect) => prospect.mailedAt || rankStatus(prospect.status) >= rankStatus("mailed")).length;
  const previewViewed = scopedProspects.filter(
    (prospect) => prospect.firstPreviewViewedAt || rankStatus(prospect.status) >= rankStatus("preview_viewed")
  ).length;
  const claimsStarted = scopedProspects.filter(
    (prospect) => prospect.claimStartedAt || rankStatus(prospect.status) >= rankStatus("claim_started")
  ).length;
  const claimed = scopedProspects.filter((prospect) => prospect.claimedAt || rankStatus(prospect.status) >= rankStatus("claimed")).length;
  const published = scopedProspects.filter(
    (prospect) => prospect.publishedAt || rankStatus(prospect.status) >= rankStatus("published")
  ).length;
  const disqualified = scopedProspects.filter((prospect) => prospect.status === "disqualified").length;
  const supportContacts = scopedEvents.filter((event) => event.type === "support_contact").length;
  const credibilityScores = scopedEvents
    .filter((event) => event.type === "credibility_feedback" && typeof event.value === "number")
    .map((event) => event.value as number);

  return {
    campaignId,
    campaigns: scopedCampaigns.length,
    prospects: scopedProspects.length,
    mailed,
    previewViewed,
    claimsStarted,
    claimed,
    published,
    disqualified,
    supportContacts,
    credibilityFeedbackCount: credibilityScores.length,
    avgCredibilityScore: credibilityScores.length
      ? round(credibilityScores.reduce((total, value) => total + value, 0) / credibilityScores.length)
      : undefined,
    mailerToPreviewRate: rate(previewViewed, mailed),
    mailerToClaimRate: rate(claimed, mailed),
    claimToPublishRate: rate(published, claimed),
    supportBurdenRate: rate(supportContacts, Math.max(claimed, 1)),
    verticalBreakdown: verticalBreakdown(scopedProspects)
  };
}

function verticalBreakdown(prospects: OutboundProspect[]): OutboundSummary["verticalBreakdown"] {
  const groups = new Map<Vertical | "unknown", OutboundProspect[]>();
  for (const prospect of prospects) {
    const key = prospect.vertical ?? "unknown";
    groups.set(key, [...(groups.get(key) ?? []), prospect]);
  }
  return Array.from(groups.entries())
    .map(([vertical, items]) => {
      const mailed = items.filter((prospect) => prospect.mailedAt || rankStatus(prospect.status) >= rankStatus("mailed")).length;
      const claimed = items.filter((prospect) => prospect.claimedAt || rankStatus(prospect.status) >= rankStatus("claimed")).length;
      const published = items.filter((prospect) => prospect.publishedAt || rankStatus(prospect.status) >= rankStatus("published")).length;
      return {
        vertical,
        prospects: items.length,
        claimed,
        published,
        mailerToClaimRate: rate(claimed, mailed)
      };
    })
    .sort((left, right) => right.prospects - left.prospects);
}

function statusAfter(current: OutboundProspect["status"], next: OutboundProspect["status"]) {
  if (current === "disqualified") return current;
  return rankStatus(next) > rankStatus(current) ? next : current;
}

function rankStatus(status: OutboundProspect["status"]) {
  return {
    queued: 0,
    mailed: 1,
    preview_viewed: 2,
    claim_started: 3,
    claimed: 4,
    published: 5,
    disqualified: -1
  }[status];
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? round(numerator / denominator) : 0;
}

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}

function cleanMetadata(metadata?: Record<string, string | number | boolean>) {
  if (!metadata) return undefined;
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !/password|token|secret|ssn|card/i.test(key))
      .map(([key, value]) => [key, value])
  );
}
