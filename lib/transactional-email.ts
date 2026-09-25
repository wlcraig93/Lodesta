export type TransactionalEmailResult =
  | { status: "sent" }
  | { status: "skipped"; reason: "email_not_configured" }
  | { status: "failed"; error: string };

/**
 * The one Lodesta email path. Callers choose the recipient; product email only
 * ever goes to an address the recipient gave us themselves (an account's
 * sign-in email, or an address typed into a form they submitted).
 */
export async function sendTransactionalEmail(input: { to: string; subject: string; text: string }): Promise<TransactionalEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { status: "skipped", reason: "email_not_configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(emailTimeoutMs()),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Lodesta <notifications@mail.lodesta.com>", to: input.to, subject: input.subject, text: input.text })
    });
    return response.ok ? { status: "sent" } : { status: "failed", error: `email_provider_status_${response.status}` };
  } catch (error) {
    return { status: "failed", error: error instanceof Error && error.name === "TimeoutError" ? "email_provider_timeout" : "email_provider_unreachable" };
  }
}

function emailTimeoutMs() {
  const parsed = Number(process.env.LODESTA_EMAIL_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 1_000
    ? Math.min(Math.trunc(parsed), 30_000)
    : 5_000;
}
