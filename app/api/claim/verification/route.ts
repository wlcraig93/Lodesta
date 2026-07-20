import { NextResponse } from "next/server";
import { z } from "zod";
import { sitePlatformRepository } from "@/packages/platform-data";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import {
  createClaimVerificationChallenge,
  verifyClaimVerificationChallenge
} from "@/lib/claim-verification-challenge";

export const runtime = "nodejs";

const verificationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    siteId: z.string().min(1),
    channel: z.enum(["email", "phone"])
  }),
  z.object({
    action: z.literal("verify"),
    siteId: z.string().min(1),
    challengeId: z.string().min(1),
    code: z.string().min(4).max(12)
  })
]);

export async function POST(request: Request) {
  const limit = rateLimit(request, {
    bucket: "claim_verification",
    limit: 12,
    windowMs: 60 * 60_000
  });
  if (!limit.ok) return limit.response;

  const body = await request.json().catch(() => null);
  const parsed = verificationSchema.safeParse(body);
  if (!parsed.success) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Invalid claim verification request", issues: parsed.error.issues }, { status: 400 }), limit);
  }

  const site = await sitePlatformRepository.getSite(parsed.data.siteId);
  const state = site ? await sitePlatformRepository.getBusinessState(site.businessId) : undefined;
  if (!site || !state) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown site" }, { status: 404 }), limit);

  if (parsed.data.action === "verify") {
    const verified = verifyClaimVerificationChallenge({
      state,
      challengeId: parsed.data.challengeId,
      code: parsed.data.code
    });
    if (!verified.ok) return applyRateLimitHeaders(NextResponse.json({ error: verified.reason }, { status: 400 }), limit);
    return applyRateLimitHeaders(
      NextResponse.json({
        ok: true,
        verification: {
          verificationLevel: verified.verificationLevel,
          verificationMethod: verified.verificationMethod,
          verifiedBy: verified.verifiedBy,
          targetLabel: verified.target.label
        }
      }),
      limit
    );
  }

  const challenge = createClaimVerificationChallenge({
    state,
    channel: parsed.data.channel
  });
  if (!challenge.ok) return applyRateLimitHeaders(NextResponse.json({ error: challenge.reason }, { status: 400 }), limit);

  const delivery = await deliverChallengeCode({
    businessName: state.identity.name,
    channel: challenge.target.channel,
    destination: challenge.target.destination,
    code: challenge.code
  });

  return applyRateLimitHeaders(
    NextResponse.json({
      ok: true,
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      targetLabel: challenge.target.label,
      delivery,
      developmentCode: delivery.status === "local_echo" ? challenge.code : undefined
    }),
    limit
  );
}

async function deliverChallengeCode(input: {
  businessName: string;
  channel: "email" | "phone";
  destination: string;
  code: string;
}): Promise<{ status: "sent" | "local_echo" | "manual_required" | "failed"; message: string; responseStatus?: number }> {
  if (input.channel !== "email") {
    if (process.env.NODE_ENV !== "production") {
      return { status: "local_echo", message: "Local verification code generated for phone challenge." };
    }
    return { status: "manual_required", message: "SMS delivery is not configured; operator verification is required." };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      return { status: "local_echo", message: "Local verification code generated for email challenge." };
    }
    return { status: "manual_required", message: "Email delivery is not configured; operator verification is required." };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(5000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Lodesta <notifications@mail.lodesta.com>",
      to: input.destination,
      subject: `${input.businessName}: Lodesta claim verification code`,
      text: [
        `Your Lodesta verification code is ${input.code}.`,
        "",
        "Use this code only if you are claiming the Lodesta-managed website preview for this business."
      ].join("\n")
    })
  });
  return {
    status: response.ok ? "sent" : "failed",
    responseStatus: response.status,
    message: response.ok ? "Verification code sent." : "Verification email request failed."
  };
}
