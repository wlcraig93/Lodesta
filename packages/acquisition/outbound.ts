import type {
  OutboundCampaign,
  OutboundEvent,
  OutboundProspect,
  OutboundSummary
} from "@/packages/platform-operations/contracts";

type Vertical = string;

export type CreateOutboundCampaignInput = {
  id?: string;
  name: string;
  channel?: OutboundCampaign["channel"];
  status?: OutboundCampaign["status"];
  metadata?: Record<string, string | number | boolean>;
};

export type OutboundComplianceStatus = {
  highVolume: boolean;
  reviewed: boolean;
  threshold: number;
  plannedRecipients?: number;
  reason?: string;
};

export type UpsertOutboundProspectInput = {
  id?: string;
  campaignId: string;
  siteId?: string;
  reportId?: string;
  businessName: string;
  vertical?: Vertical;
  sourceUrl?: string;
  previewId?: string;
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

export type OutboundMailerManifestRow = {
  campaignId: string;
  campaignName: string;
  campaignStatus: OutboundCampaign["status"];
  complianceStatus: "ok" | "reviewed_high_volume" | "needs_review";
  prospectId: string;
  businessName: string;
  vertical: Vertical | "unknown";
  status: OutboundProspect["status"];
  sourceUrl: string;
  previewUrl: string;
  reportUrl: string;
  reportStatus: string;
  mailingCode: string;
  mailedAt: string;
  firstReportViewedAt: string;
  firstPreviewViewedAt: string;
  adoptedAt: string;
  publishedAt: string;
};

export function newOutboundCampaign(input: CreateOutboundCampaignInput): OutboundCampaign {
  const now = new Date().toISOString();
  return {
    id: input.id ?? crypto.randomUUID(),
    name: input.name.trim(),
    channel: input.channel ?? "direct_mail",
    status: input.status ?? "draft",
    createdAt: now,
    startedAt: input.status === "running" ? now : undefined,
    metadata: cleanMetadata(input.metadata)
  };
}

export function outboundComplianceStatus(input: {
  channel?: OutboundCampaign["channel"];
  status?: OutboundCampaign["status"];
  metadata?: Record<string, string | number | boolean>;
}): OutboundComplianceStatus {
  const threshold = outboundHighVolumeThreshold();
  const plannedRecipients = plannedRecipientCount(input.metadata);
  const highVolume = Boolean(input.metadata?.highVolume === true || (plannedRecipients !== undefined && plannedRecipients >= threshold));
  const reviewed = hasLegalReview(input.metadata);
  const outreachChannel = input.channel === undefined || input.channel === "direct_mail" || input.channel === "email" || input.channel === "phone";
  const active = input.status === "running";
  const missingEmailCompliance = active && input.channel === "email" && !hasEmailCompliance(input.metadata);
  const reason =
    missingEmailCompliance
      ? "Email outbound requires an identified sender, physical mailing address, working opt-out, and suppression-list review before launch."
      : active && outreachChannel && highVolume && !reviewed
      ? "High-volume outbound requires IP/legal review before launch. Add legalReviewedAt and legalReviewer metadata, or keep the campaign in draft/paused."
      : undefined;

  return {
    highVolume,
    reviewed,
    threshold,
    plannedRecipients,
    reason
  };
}

export function assertOutboundCompliance(input: CreateOutboundCampaignInput) {
  const status = outboundComplianceStatus(input);
  if (status.reason) {
    return { ok: false as const, status };
  }
  return { ok: true as const, status };
}

export function newOutboundProspect(input: UpsertOutboundProspectInput): OutboundProspect {
  const now = new Date().toISOString();
  return {
    id: input.id ?? crypto.randomUUID(),
    campaignId: input.campaignId,
    siteId: input.siteId,
    reportId: input.reportId,
    businessName: input.businessName.trim(),
    vertical: input.vertical,
    sourceUrl: input.sourceUrl,
    previewId: input.previewId,
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
  if (event.type === "report_viewed") {
    prospect.firstReportViewedAt ??= occurredAt;
  }
  if (event.type === "mailer_sent") {
    prospect.status = statusAfter(prospect.status, "mailed");
    prospect.mailedAt ??= occurredAt;
  }
  if (event.type === "invitation_opened" || event.type === "preview_viewed") {
    prospect.status = statusAfter(prospect.status, "preview_viewed");
    prospect.firstPreviewViewedAt ??= occurredAt;
  }
  if (event.type === "adoption_started") {
    prospect.status = statusAfter(prospect.status, "adoption_started");
    prospect.adoptionStartedAt ??= occurredAt;
  }
  if (event.type === "adoption_completed") {
    prospect.status = statusAfter(prospect.status, "adopted");
    prospect.adoptedAt ??= occurredAt;
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
  const reportViewed = scopedProspects.filter((prospect) => prospect.firstReportViewedAt).length;
  const adoptionsStarted = scopedProspects.filter(
    (prospect) => prospect.adoptionStartedAt || rankStatus(prospect.status) >= rankStatus("adoption_started")
  ).length;
  const adopted = scopedProspects.filter((prospect) => prospect.adoptedAt || rankStatus(prospect.status) >= rankStatus("adopted")).length;
  const published = scopedProspects.filter(
    (prospect) => prospect.publishedAt || rankStatus(prospect.status) >= rankStatus("published")
  ).length;
  const disqualified = scopedProspects.filter((prospect) => prospect.status === "disqualified").length;
  const supportContacts = scopedEvents.filter((event) => event.type === "support_contact").length;
  const credibilityScores = scopedEvents
    .filter((event) => event.type === "credibility_feedback" && typeof event.value === "number")
    .map((event) => event.value as number);
  const invitationOpened = Math.max(
    previewViewed,
    uniqueProspectEventCount(scopedEvents, scopedProspects, ["invitation_opened", "preview_viewed"])
  );
  const pickerInteractions = uniqueProspectEventCount(scopedEvents, scopedProspects, ["picker_interaction"]);
  return {
    campaignId,
    campaigns: scopedCampaigns.length,
    prospects: scopedProspects.length,
    mailed,
    reportViewed,
    invitationOpened,
    previewViewed,
    pickerInteractions,
    adoptionsStarted,
    adopted,
    published,
    disqualified,
    supportContacts,
    credibilityFeedbackCount: credibilityScores.length,
    avgCredibilityScore: credibilityScores.length
      ? round(credibilityScores.reduce((total, value) => total + value, 0) / credibilityScores.length)
      : undefined,
    mailerToPreviewRate: rate(previewViewed, mailed),
    mailerToReportRate: rate(reportViewed, mailed),
    mailerToAdoptionRate: rate(adopted, mailed),
    invitationToAdoptionRate: rate(adopted, invitationOpened),
    adoptionToPublishRate: rate(published, adopted),
    supportBurdenRate: rate(supportContacts, Math.max(adopted, 1)),
    verticalBreakdown: verticalBreakdown(scopedProspects, scopedEvents)
  };
}

export function buildOutboundMailerManifest(
  campaigns: OutboundCampaign[],
  prospects: OutboundProspect[],
  campaignId: string | undefined,
  previewLinks: ReadonlyMap<string, string>,
  reportLinks: ReadonlyMap<string, { url: string; status: string }>
): OutboundMailerManifestRow[] {
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const suppressedKeys = outboundSuppressionKeys(prospects);
  return prospects
    .filter((prospect) => !campaignId || prospect.campaignId === campaignId)
    .filter((prospect) => !isProspectSuppressed(prospect, suppressedKeys))
    .map((prospect) => {
      const campaign = campaignById.get(prospect.campaignId);
      const compliance = outboundComplianceStatus(campaign ?? {});
      const complianceStatus: OutboundMailerManifestRow["complianceStatus"] = compliance.reason
        ? "needs_review"
        : compliance.highVolume
          ? "reviewed_high_volume"
          : "ok";
      const vertical: OutboundMailerManifestRow["vertical"] = prospect.vertical ?? "unknown";
      const report = prospect.reportId ? reportLinks.get(prospect.reportId) : undefined;
      return {
        campaignId: prospect.campaignId,
        campaignName: campaign?.name ?? "Unknown campaign",
        campaignStatus: campaign?.status ?? "draft",
        complianceStatus,
        prospectId: prospect.id,
        businessName: prospect.businessName,
        vertical,
        status: prospect.status,
        sourceUrl: prospect.sourceUrl ?? "",
        previewUrl: prospect.previewId ? previewLinks.get(prospect.previewId) ?? "" : "",
        reportUrl: report?.url ?? "",
        reportStatus: report?.status ?? "",
        mailingCode: prospect.mailingCode ?? "",
        mailedAt: prospect.mailedAt ?? "",
        firstReportViewedAt: prospect.firstReportViewedAt ?? "",
        firstPreviewViewedAt: prospect.firstPreviewViewedAt ?? "",
        adoptedAt: prospect.adoptedAt ?? "",
        publishedAt: prospect.publishedAt ?? ""
      };
    })
    .sort((left, right) => `${left.campaignName}:${left.businessName}`.localeCompare(`${right.campaignName}:${right.businessName}`));
}

export function outboundMailerManifestCsv(rows: OutboundMailerManifestRow[]) {
  const headers: Array<keyof OutboundMailerManifestRow> = [
    "campaignId",
    "campaignName",
    "campaignStatus",
    "complianceStatus",
    "prospectId",
    "businessName",
    "vertical",
    "status",
    "sourceUrl",
    "previewUrl",
    "reportUrl",
    "reportStatus",
    "mailingCode",
    "mailedAt",
    "firstReportViewedAt",
    "firstPreviewViewedAt",
    "adoptedAt",
    "publishedAt"
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(String(row[header] ?? ""))).join(","))
  ];
  return `${lines.join("\n")}\n`;
}

function verticalBreakdown(prospects: OutboundProspect[], events: OutboundEvent[]): OutboundSummary["verticalBreakdown"] {
  const groups = new Map<Vertical | "unknown", OutboundProspect[]>();
  for (const prospect of prospects) {
    const key = prospect.vertical ?? "unknown";
    groups.set(key, [...(groups.get(key) ?? []), prospect]);
  }
  return Array.from(groups.entries())
    .map(([vertical, items]) => {
      const mailed = items.filter((prospect) => prospect.mailedAt || rankStatus(prospect.status) >= rankStatus("mailed")).length;
      const itemEvents = eventsForProspects(events, items);
      const invitationOpened = Math.max(
        items.filter((prospect) => prospect.firstPreviewViewedAt || rankStatus(prospect.status) >= rankStatus("preview_viewed")).length,
        uniqueProspectEventCount(itemEvents, items, ["invitation_opened", "preview_viewed"])
      );
      const adopted = items.filter((prospect) => prospect.adoptedAt || rankStatus(prospect.status) >= rankStatus("adopted")).length;
      const published = items.filter((prospect) => prospect.publishedAt || rankStatus(prospect.status) >= rankStatus("published")).length;
      return {
        vertical,
        prospects: items.length,
        invitationOpened,
        adopted,
        published,
        invitationToAdoptionRate: rate(adopted, invitationOpened),
        mailerToAdoptionRate: rate(adopted, mailed)
      };
    })
    .sort((left, right) => right.prospects - left.prospects);
}

function uniqueProspectEventCount(
  events: OutboundEvent[],
  prospects: OutboundProspect[],
  types: OutboundEvent["type"][]
) {
  const targetTypes = new Set(types);
  const prospectBySite = new Map(prospects.filter((prospect) => prospect.siteId).map((prospect) => [prospect.siteId as string, prospect.id]));
  const keys = new Set<string>();
  for (const event of events) {
    if (!targetTypes.has(event.type)) continue;
    const key = event.prospectId ?? (event.siteId ? prospectBySite.get(event.siteId) ?? `site:${event.siteId}` : `event:${event.id}`);
    keys.add(key);
  }
  return keys.size;
}

function eventsForProspects(events: OutboundEvent[], prospects: OutboundProspect[]) {
  const prospectIds = new Set(prospects.map((prospect) => prospect.id));
  const siteIds = new Set(prospects.map((prospect) => prospect.siteId).filter(Boolean));
  return events.filter(
    (event) => (event.prospectId && prospectIds.has(event.prospectId)) || (event.siteId && siteIds.has(event.siteId))
  );
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
    adoption_started: 3,
    adopted: 4,
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

function outboundSuppressionKeys(prospects: OutboundProspect[]) {
  const keys = new Set<string>();
  for (const prospect of prospects) {
    const key = suppressionKeyForProspect(prospect);
    if (!key) continue;
    if (prospect.status === "disqualified" || prospect.metadata?.suppressed === true || prospect.metadata?.optedOut === true) {
      keys.add(key);
    }
  }
  return keys;
}

function isProspectSuppressed(prospect: OutboundProspect, suppressedKeys: Set<string>) {
  const key = suppressionKeyForProspect(prospect);
  return Boolean(key && suppressedKeys.has(key));
}

function suppressionKeyForProspect(prospect: Pick<OutboundProspect, "sourceUrl" | "mailingCode" | "metadata">) {
  const explicit = stringMetadata(prospect.metadata, "suppressionKey");
  if (explicit) return `key:${explicit.toLowerCase()}`;
  const email = stringMetadata(prospect.metadata, "contactEmail");
  if (email && email.includes("@")) return `email:${email.trim().toLowerCase()}`;
  const mailingCode = prospect.mailingCode?.trim().toLowerCase();
  if (mailingCode) return `mail:${mailingCode}`;
  if (prospect.sourceUrl) {
    try {
      return `host:${new URL(prospect.sourceUrl).hostname.toLowerCase()}`;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function outboundHighVolumeThreshold() {
  const configured = Number(process.env.LODESTA_OUTBOUND_HIGH_VOLUME_THRESHOLD);
  return Number.isFinite(configured) && configured > 0 ? configured : 100;
}

function plannedRecipientCount(metadata: Record<string, string | number | boolean> | undefined) {
  if (!metadata) return undefined;
  for (const key of ["plannedRecipients", "plannedProspects", "plannedProspectCount", "mailerQuantity", "recipientCount"]) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function hasLegalReview(metadata: Record<string, string | number | boolean> | undefined) {
  if (!metadata) return false;
  if (metadata.legalApproved === true) return true;
  return typeof metadata.legalReviewedAt === "string" && metadata.legalReviewedAt.trim().length > 0;
}

function hasEmailCompliance(metadata: Record<string, string | number | boolean> | undefined) {
  if (!metadata) return false;
  const hasSender = metadata.senderIdentified === true || Boolean(stringMetadata(metadata, "senderName"));
  const hasPhysicalAddress = Boolean(stringMetadata(metadata, "physicalAddress"));
  const hasOptOut = Boolean(stringMetadata(metadata, "optOutUrl") || stringMetadata(metadata, "optOutInstructions"));
  const suppressionReviewed = Boolean(stringMetadata(metadata, "suppressionListReviewedAt") || metadata.suppressionListReviewed === true);
  return hasSender && hasPhysicalAddress && hasOptOut && suppressionReviewed;
}

function stringMetadata(metadata: Record<string, string | number | boolean> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}
