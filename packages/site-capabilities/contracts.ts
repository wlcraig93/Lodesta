export type InquirySourceChannel = "form" | "chat" | "email" | "phone" | "sms" | "booking";
export type InquiryStatus = "new" | "needs_reply" | "replied" | "booked" | "won" | "lost" | "spam" | "archived";
export type InquiryNotificationState = "queued" | "processing" | "completed" | "partial" | "failed" | "skipped";
export type InquiryAiEnrichmentState = "queued" | "processing" | "succeeded" | "retrying" | "rate_limited" | "failed" | "skipped";

export type InquiryAiEnrichment = {
  schemaVersion: string;
  promptVersion: string;
  provider: "groq";
  model: string;
  intent: string;
  urgency: string;
  spamLikelihood: "low" | "medium" | "high" | "unknown";
  serviceInterest?: string | null;
  contactPreference?: "email" | "phone" | "unknown" | null;
  summary: string;
  missingInfo: string[];
  suggestedNextAction: string;
  recommendedStatus: Extract<InquiryStatus, "needs_reply" | "spam" | "archived">;
  confidence: number;
  safetyFlags: string[];
  createdAt: string;
};

export type Inquiry = {
  id: string;
  siteId: string;
  sourceChannel: InquirySourceChannel;
  contactName?: string;
  contactEmail?: string;
  contactEmailNormalized?: string;
  contactPhone?: string;
  contactPhoneNormalized?: string;
  status: InquiryStatus;
  notificationState: InquiryNotificationState;
  aiEnrichmentState: InquiryAiEnrichmentState;
  aiEnrichment?: InquiryAiEnrichment;
  aiEnrichedAt?: string;
  aiEnrichmentError?: string;
  createdAt: string;
  updatedAt: string;
};

export type InquiryEvent = {
  id: string;
  siteId: string;
  inquiryId: string;
  type: "form_submission" | "chat_message" | "email_received" | "email_sent" | "owner_note" | "ai_note" | "booking_created";
  actor: "visitor" | "owner" | "ai" | "system";
  messageText?: string;
  payload?: Record<string, unknown>;
  sourceUrl?: string;
  pageId?: string;
  formId?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
  createdAt: string;
};

export type CapabilityFormDefinition = {
  id: string;
  fields: Array<{ id: string; label: string; type: "text" | "email" | "phone" | "textarea" | "select" }>;
};

export const analyticsEventTypes = [
  "page_view",
  "engagement",
  "form_start",
  "form_submit",
  "call_click",
  "email_click",
  "directions_click",
  "booking_click",
  "ordering_click",
  "outbound_click",
  "web_vital"
] as const;

export type AnalyticsEventType = typeof analyticsEventTypes[number];
export type AnalyticsActionType = Extract<AnalyticsEventType,
  "form_submit" | "call_click" | "email_click" | "directions_click" | "booking_click" | "ordering_click"
>;
export type AnalyticsDeviceCategory = "mobile" | "tablet" | "desktop";
export type AnalyticsChannel = "campaign" | "organic_search" | "social" | "referral" | "direct";
export type AnalyticsTrafficClass = "human" | "lodesta_internal" | "known_bot" | "invalid";
export type AnalyticsCollectionReason = "accepted" | "internal" | "bot" | "preview" | "duplicate" | "invalid";

export type AnalyticsEvent = {
  schemaVersion: 1;
  eventId: string;
  siteId: string;
  siteVersionId: string;
  eventType: AnalyticsEventType;
  visitorKey: string;
  visitId: string;
  pagePath: string;
  landingPath: string;
  channel: AnalyticsChannel;
  source?: string;
  medium?: string;
  campaign?: string;
  referrerHost?: string;
  deviceCategory: AnalyticsDeviceCategory;
  properties: Record<string, string | number | boolean>;
  occurredAt: string;
  createdAt: string;
};

export type AnalyticsReportView = "overview" | "traffic" | "content" | "actions";
export type AnalyticsReportInterval = "day" | "week" | "month";
export type AnalyticsReportQuery = {
  view: AnalyticsReportView;
  from: string;
  to: string;
  compareFrom?: string;
  compareTo?: string;
  interval: AnalyticsReportInterval;
  timezone: string;
  filters: {
    channel?: AnalyticsChannel;
    source?: string;
    page?: string;
    action?: AnalyticsActionType;
    device?: AnalyticsDeviceCategory;
  };
};

export type AnalyticsTotals = {
  visitors: number;
  visits: number;
  pageViews: number;
  leads: number;
  customerActions: number;
  actionVisits: number;
  actionRate: number;
  formStarts: number;
  engagedSeconds: number;
  medianSecondsToAction?: number;
};

export type AnalyticsReportRow = {
  key: string;
  label: string;
  visitors: number;
  visits: number;
  pageViews: number;
  customerActions: number;
  actionRate: number;
  engagedSeconds: number;
  exits: number;
};

export type AnalyticsTrendPoint = {
  bucket: string;
  visits: number;
  customerActions: number;
};

export type AnalyticsCollectionHealth = {
  lastAcceptedAt?: string;
  accepted: number;
  internal: number;
  bot: number;
  preview: number;
  duplicate: number;
  invalid: number;
};

export type AnalyticsRecommendation = {
  key: string;
  title: string;
  detail: string;
  denominator: string;
};

export type AnalyticsReport = {
  siteId: string;
  query: AnalyticsReportQuery;
  current: AnalyticsTotals;
  comparison?: AnalyticsTotals;
  trend: AnalyticsTrendPoint[];
  channels: AnalyticsReportRow[];
  sources: AnalyticsReportRow[];
  campaigns: AnalyticsReportRow[];
  pages: AnalyticsReportRow[];
  landingPages: AnalyticsReportRow[];
  actions: AnalyticsReportRow[];
  devices: AnalyticsReportRow[];
  visitorTypes: AnalyticsReportRow[];
  collectionHealth: AnalyticsCollectionHealth;
  sufficiency: "empty" | "early" | "sufficient";
  recommendations: AnalyticsRecommendation[];
};
