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

export type AnalyticsEvent = {
  siteId: string;
  sessionId: string;
  visitorId?: string;
  pageId?: string;
  eventType:
    | "pageview"
    | "click"
    | "section_view"
    | "form_start"
    | "form_submit"
    | "tel_click"
    | "outbound_click"
    | "engagement"
    | "scroll_depth"
    | "web_vital"
    | "experiment_assignment"
    | "agent_readable_request"
    | "places_ui";
  timestamp: string;
  sectionId?: string;
  elementRole?: string;
  elementType?: string;
  hrefType?: "internal" | "tel" | "mailto" | "booking" | "ordering" | "external";
  normalizedX?: number;
  normalizedY?: number;
  viewport?: { width: number; height: number };
  deviceType?: "mobile" | "tablet" | "desktop";
  value?: number;
  metadata?: Record<string, string | number | boolean>;
};

export type AnalyticsSummary = {
  siteId: string;
  events: number;
  sessions: number;
  pageviews: number;
  clicks: number;
  telClicks: number;
  formStarts: number;
  formSubmits: number;
  outboundClicks: number;
  primaryActions: number;
  actionRate: number;
  engagedMs: number;
  avgEngagedSeconds: number;
  avgTimeToActionMs?: number;
  medianTimeToActionMs?: number;
  avgScrollDepth: number;
  webVitals: Array<{ metric?: string | number | boolean; value?: number; timestamp: string }>;
  agentReadableRequests: number;
  agentReadableByResource: AnalyticsAgentReadableResource[];
  placesUi: { loads: number; failures: number; fallbacks: number; fallbackRate: number; estimatedCostUsd: number };
  outcomesByPage: AnalyticsOutcomeRow[];
  outcomesByCtaRole: AnalyticsOutcomeRow[];
  outcomesBySection: AnalyticsOutcomeRow[];
  funnelDropoffs: AnalyticsFunnelDropoff[];
  sectionConversionPaths: AnalyticsSectionConversionPath[];
  outcomesByExperimentVariant: AnalyticsOutcomeRow[];
  outcomesBySource: AnalyticsOutcomeRow[];
  clickMap: AnalyticsClickMapPoint[];
  standardCorrelations: AnalyticsStandardCorrelation[];
  baselineComparison: {
    status: "collecting" | "ready";
    baselineStart?: string;
    baselineEnd?: string;
    currentStart?: string;
    currentEnd?: string;
    baseline: AnalyticsOutcomeTotals;
    current: AnalyticsOutcomeTotals;
    delta: { sessions: number; primaryActions: number; actionRate: number };
  };
};

export type AnalyticsAgentReadableResource = { key: string; label: string; requests: number; sessions: number; latestAt?: string };
export type AnalyticsFunnelDropoff = { key: string; from: string; to: string; fromCount: number; toCount: number; dropoffCount: number; conversionRate: number; dropoffRate: number };
export type AnalyticsSectionConversionPath = { key: string; sectionId: string; exposedSessions: number; exposures: number; actionSessions: number; primaryActions: number; telClicks: number; formSubmits: number; outboundClicks: number; actionRate: number; avgTimeToActionMs?: number; medianTimeToActionMs?: number };
export type AnalyticsClickMapPoint = { key: string; label: string; count: number; primaryActions: number; pageId?: string; sectionId?: string; elementRole?: string; hrefType?: AnalyticsEvent["hrefType"]; deviceType?: AnalyticsEvent["deviceType"]; normalizedX: number; normalizedY: number };
export type AnalyticsStandardCorrelation = { criterionId: string; title: string; layer: "technical_seo" | "conversion" | "trust" | "content_structure"; metric: string; events: number; primaryActions: number; rate: number; signal: "collecting" | "positive" | "watch" | "weak"; insight: string };

export type AnalyticsOutcomeTotals = {
  sessions: number;
  pageviews: number;
  telClicks: number;
  formStarts: number;
  formSubmits: number;
  outboundClicks: number;
  primaryActions: number;
  actionRate: number;
  engagedMs: number;
  avgEngagedSeconds: number;
  avgTimeToActionMs?: number;
  medianTimeToActionMs?: number;
  avgScrollDepth: number;
};

export type AnalyticsOutcomeRow = AnalyticsOutcomeTotals & {
  key: string;
  label: string;
  events: number;
};
