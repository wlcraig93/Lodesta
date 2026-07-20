import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { BusinessStateV2 } from "@/packages/site-contracts";

export type ClaimVerificationChannel = "email" | "phone";

export type ClaimVerificationTarget = {
  channel: ClaimVerificationChannel;
  destination: string;
  label: string;
  auditLabel: string;
};

type ChallengePayload = {
  v: 1;
  siteId: string;
  channel: ClaimVerificationChannel;
  destination: string;
  codeHash: string;
  nonce: string;
  exp: number;
};

const challengeTtlMs = 15 * 60_000;

export function claimVerificationTargets(state: BusinessStateV2): ClaimVerificationTarget[] {
  const targets: ClaimVerificationTarget[] = [];
  if (state.contacts.email) {
    const destination = state.contacts.email.trim().toLowerCase();
    targets.push({
      channel: "email",
      destination,
      label: maskEmail(destination),
      auditLabel: `email:${destination}`
    });
  }
  if (state.contacts.phone) {
    const destination = normalizePhone(state.contacts.phone);
    if (destination) {
      targets.push({
        channel: "phone",
        destination,
        label: maskPhone(destination),
        auditLabel: `phone:${destination}`
      });
    }
  }
  return targets;
}

export function createClaimVerificationChallenge(input: {
  state: BusinessStateV2;
  channel: ClaimVerificationChannel;
  now?: number;
  code?: string;
}) {
  const target = claimVerificationTargets(input.state).find((candidate) => candidate.channel === input.channel);
  if (!target) return { ok: false as const, reason: "No independently sourced business contact is available for that channel." };

  const code = input.code ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
  const nonce = randomToken();
  const exp = (input.now ?? Date.now()) + challengeTtlMs;
  const payload: ChallengePayload = {
    v: 1,
    siteId: input.state.siteId,
    channel: target.channel,
    destination: target.destination,
    codeHash: challengeCodeHash(input.state.siteId, target.destination, code, nonce),
    nonce,
    exp
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return {
    ok: true as const,
    challengeId: `${encoded}.${sign(encoded)}`,
    code,
    target,
    expiresAt: new Date(exp).toISOString()
  };
}

export function verifyClaimVerificationChallenge(input: {
  state: BusinessStateV2;
  challengeId: string;
  code: string;
  now?: number;
}) {
  const payload = parseChallengePayload(input.challengeId);
  if (!payload) return { ok: false as const, reason: "Invalid verification challenge." };
  if (payload.siteId !== input.state.siteId) {
    return { ok: false as const, reason: "Verification challenge does not match this site." };
  }
  if ((input.now ?? Date.now()) > payload.exp) return { ok: false as const, reason: "Verification challenge expired." };

  const target = claimVerificationTargets(input.state).find(
    (candidate) => candidate.channel === payload.channel && candidate.destination === payload.destination
  );
  if (!target) return { ok: false as const, reason: "Business contact no longer matches this verification challenge." };

  const expected = challengeCodeHash(payload.siteId, payload.destination, input.code.trim(), payload.nonce);
  if (!safeEqual(expected, payload.codeHash)) return { ok: false as const, reason: "Verification code is incorrect." };
  return {
    ok: true as const,
    verificationLevel: "contact_verified" as const,
    verificationMethod: "business_contact_challenge",
    verifiedBy: target.auditLabel,
    target
  };
}

function challengeCodeHash(siteId: string, destination: string, code: string, nonce: string) {
  return hmac(`${siteId}:${destination}:${code}:${nonce}`);
}

function parseChallengePayload(challengeId: string): ChallengePayload | null {
  const [encoded, signature] = challengeId.split(".");
  if (!encoded || !signature || !safeEqual(sign(encoded), signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<ChallengePayload>;
    if (
      parsed.v !== 1 ||
      typeof parsed.siteId !== "string" ||
      (parsed.channel !== "email" && parsed.channel !== "phone") ||
      typeof parsed.destination !== "string" ||
      typeof parsed.codeHash !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    return parsed as ChallengePayload;
  } catch {
    return null;
  }
}

function hmac(value: string) {
  return createHmac("sha256", claimChallengeSecret()).update(value).digest("base64url");
}

function sign(value: string) {
  return hmac(`claim-challenge:${value}`);
}

function claimChallengeSecret() {
  const secret = process.env.LODESTA_CLAIM_CHALLENGE_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("LODESTA_CLAIM_CHALLENGE_SECRET is required in production.");
  return "lodesta-local-claim-challenge-secret";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function randomToken() {
  return randomBytes(16).toString("base64url");
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function normalizePhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? digits : "";
}

function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!local || !domain) return value;
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `***-${digits.slice(-4)}` : "***";
}
