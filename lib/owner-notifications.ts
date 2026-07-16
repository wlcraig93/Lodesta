import { configuredAppOriginOrDefault } from "./app-origin";
import type { ClaimRecord, SiteBundle } from "./models";

export type OwnerOperationalNotificationKind =
  | "proposal_ready"
  | "draft_awaiting_publish"
  | "inquiry_digest"
  | "payment_failure";

export type OwnerOperationalNotificationResult = {
  kind: OwnerOperationalNotificationKind;
  siteId: string;
  status: "sent" | "skipped" | "failed";
  target?: string;
  message: string;
  responseStatus?: number;
  providerMessageId?: string;
  error?: string;
};

export async function sendOwnerOperationalEmail(input: {
  bundle: SiteBundle;
  claims?: ClaimRecord[];
  kind: OwnerOperationalNotificationKind;
  subject: string;
  summaryLines: string[];
  actionPath?: string;
}): Promise<OwnerOperationalNotificationResult> {
  const target = ownerNotificationTarget(input.bundle, input.claims ?? []);
  if (!target) {
    return {
      kind: input.kind,
      siteId: input.bundle.businessProfile.siteId,
      status: "skipped",
      message: "Owner notification skipped because no owner or business email is available."
    };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      kind: input.kind,
      siteId: input.bundle.businessProfile.siteId,
      status: "skipped",
      target,
      message: "Owner notification logged only. Set RESEND_API_KEY to send operational emails."
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(ownerNotificationTimeoutMs()),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Lodesta <notifications@mail.lodesta.com>",
      to: target,
      subject: input.subject,
      text: ownerNotificationText(input)
    })
  });

  const payload = (await response.json().catch(() => null)) as { id?: string } | null;
  return {
    kind: input.kind,
    siteId: input.bundle.businessProfile.siteId,
    status: response.ok ? "sent" : "failed",
    target,
    responseStatus: response.status,
    providerMessageId: payload?.id,
    message: response.ok ? "Owner operational email sent." : "Owner operational email request failed.",
    error: response.ok ? undefined : JSON.stringify(payload) || (await response.text().catch(() => undefined))
  };
}

export function ownerNotificationTarget(bundle: SiteBundle, claims: ClaimRecord[]) {
  return [
    ...claims
      .filter((claim) => claim.status === "claimed")
      .map((claim) => claim.ownerEmail)
      .filter((email): email is string => Boolean(email)),
    ...bundle.extensionModel.workflows
      .filter((workflow) => workflow.destination === "email")
      .map((workflow) => workflow.config.to)
      .filter((email): email is string => typeof email === "string" && email.includes("@")),
    bundle.businessProfile.email
  ]
    .map((email) => email?.trim().toLowerCase())
    .find((email) => Boolean(email));
}

function ownerNotificationText(input: {
  bundle: SiteBundle;
  kind: OwnerOperationalNotificationKind;
  subject: string;
  summaryLines: string[];
  actionPath?: string;
}) {
  const actionUrl = input.actionPath ? `${configuredAppOriginOrDefault()}${input.actionPath}` : undefined;
  return [
    input.subject,
    "",
    `Site: ${input.bundle.businessProfile.name}`,
    `Notification: ${input.kind.replace(/_/g, " ")}`,
    "",
    ...input.summaryLines,
    actionUrl ? "" : undefined,
    actionUrl ? `Open in Lodesta: ${actionUrl}` : undefined
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function ownerNotificationTimeoutMs() {
  const parsed = Number(process.env.LODESTA_WORKFLOW_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5000;
  return Math.min(Math.max(Math.trunc(parsed), 1000), 30000);
}
