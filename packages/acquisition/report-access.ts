import { createHash, randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";

const reportAccessTtlMs = 30 * 24 * 60 * 60_000;

export function reportAccessCookieName(reportId: string) {
  return `lodesta_report_${createHash("sha256").update(reportId).digest("hex").slice(0, 20)}`;
}

export function outboundReportOperatorCookieName(reportId: string) {
  return `lodesta_report_operator_${createHash("sha256").update(reportId).digest("hex").slice(0, 20)}`;
}

export async function issueProspectReportAccessGrant(input: {
  reportId: string;
  leadId: string;
}) {
  const secret = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + reportAccessTtlMs).toISOString();
  const grant = await repository.createProspectReportAccessGrant({
    reportId: input.reportId,
    leadId: input.leadId,
    tokenHash: prospectReportAccessTokenHash(secret),
    expiresAt
  });
  return { grant, secret };
}

export async function prospectReportAccessForRequest(request: Request, reportId: string) {
  const secret = readCookie(request.headers.get("cookie"), reportAccessCookieName(reportId));
  if (!secret) return null;
  const grant = await repository.findActiveProspectReportAccessGrant(
    reportId,
    prospectReportAccessTokenHash(secret)
  );
  if (!grant) return null;
  await repository.markProspectReportAccessGrantUsed(grant.id);
  return grant;
}

export async function prospectReportAccessForSecret(reportId: string, secret: string) {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(secret)) return null;
  const grant = await repository.findActiveProspectReportAccessGrant(
    reportId,
    prospectReportAccessTokenHash(secret)
  );
  if (!grant) return null;
  await repository.markProspectReportAccessGrantUsed(grant.id);
  return grant;
}

export function setProspectReportAccessCookie(
  response: NextResponse,
  request: Request,
  input: { reportId: string; secret: string; expiresAt: string }
) {
  response.cookies.set(reportAccessCookieName(input.reportId), input.secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    expires: new Date(input.expiresAt)
  });
}

export function setOutboundReportOperatorCookie(
  response: NextResponse,
  request: Request,
  reportId: string
) {
  response.cookies.set(outboundReportOperatorCookieName(reportId), "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 5 * 60
  });
}

export function hasOutboundReportOperatorCookie(request: Request, reportId: string) {
  return readCookie(
    request.headers.get("cookie"),
    outboundReportOperatorCookieName(reportId)
  ) === "1";
}

export function prospectReportAccessTokenHash(secret: string) {
  return `sha256:${createHash("sha256").update(secret).digest("hex")}`;
}

export function prospectReportEmailLink(origin: string, reportId: string, secret: string) {
  return `${origin.replace(/\/$/, "")}/website-health-report/${encodeURIComponent(reportId)}#access=${encodeURIComponent(secret)}`;
}

function readCookie(header: string | null, name: string) {
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return undefined;
}
