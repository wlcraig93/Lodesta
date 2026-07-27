export type ProspectReportEmailDelivery = {
  status: "sent" | "skipped" | "failed";
  message: string;
};

export async function sendProspectReportAccessEmail(input: {
  email: string;
  businessName?: string;
  reportUrl: string;
}): Promise<ProspectReportEmailDelivery> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      status: "skipped",
      message: "The report is unlocked here, but email delivery is not configured. You can resend after delivery is available."
    };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(reportEmailTimeoutMs()),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Lodesta <notifications@mail.lodesta.com>",
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
      })
    });
    if (!response.ok) {
      return {
        status: "failed",
        message: "The report is unlocked here, but the access email could not be delivered. You can resend it."
      };
    }
    return {
      status: "sent",
      message: `The complete report is unlocked and a secure access link was sent to ${input.email}.`
    };
  } catch {
    return {
      status: "failed",
      message: "The report is unlocked here, but the access email timed out. You can resend it."
    };
  }
}

function reportEmailTimeoutMs() {
  const parsed = Number(process.env.LODESTA_REPORT_EMAIL_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 1_000
    ? Math.min(Math.trunc(parsed), 30_000)
    : 5_000;
}
