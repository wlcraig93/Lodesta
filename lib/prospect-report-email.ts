import { sendTransactionalEmail } from "./transactional-email";

export type ProspectReportEmailDelivery = {
  status: "sent" | "skipped" | "failed";
  message: string;
};

/** Sends the report link to the address the requester typed into the report form. */
export async function sendProspectReportAccessEmail(input: {
  email: string;
  businessName?: string;
  reportUrl: string;
}): Promise<ProspectReportEmailDelivery> {
  const delivery = await sendTransactionalEmail({
    to: input.email,
    subject: `Your Website Health Report${input.businessName ? ` for ${input.businessName}` : ""}`,
    text: [
      "Your Lodesta Website Health Report is ready.",
      "",
      "Open the complete report on any device:",
      input.reportUrl,
      "",
      "This email delivers the report you requested. It does not subscribe you to marketing messages.",
      "",
      "The access link expires in 30 days."
    ].join("\n")
  });
  if (delivery.status === "skipped") {
    return { status: "skipped", message: "The report is unlocked here, but email delivery is not configured. You can resend after delivery is available." };
  }
  if (delivery.status === "failed") {
    return {
      status: "failed",
      message: delivery.error === "email_provider_timeout"
        ? "The report is unlocked here, but the access email timed out. You can resend it."
        : "The report is unlocked here, but the access email could not be delivered. You can resend it."
    };
  }
  return { status: "sent", message: `The complete report is unlocked and a secure access link was sent to ${input.email}.` };
}
