import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin, requireAdminOrSiteOwner } from "@/lib/security";
import { normalizeCustomHostname } from "@/lib/domains";
import { claimGateForBundle } from "@/lib/site-publication";

const domainSchema = z.object({
  siteId: z.string().min(1),
  hostname: z.string().min(3),
  provider: z.enum(["railway", "cloudflare_for_saas"]).optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = domainSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid domain request", issues: parsed.error.issues }, { status: 400 });
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (parsed.data.provider === "railway" && !manualCustomDomainsAllowed()) {
    return NextResponse.json(
      {
        error:
          "Railway/manual custom domains are disabled in deployed mode. Use Cloudflare for SaaS or set LODESTA_ALLOW_MANUAL_CUSTOM_DOMAINS=true for an explicitly managed exception."
      },
      { status: 400 }
    );
  }
  const claimGate = claimGateForBundle(bundle, await repository.listClaims(parsed.data.siteId));
  if (!claimGate.ok) {
    const verificationRequired = claimGate.code === "verification_required";
    return NextResponse.json(
      {
        error: claimGate.reason,
        claimGate: claimGate.code,
        paymentRequired: !verificationRequired,
        factVerificationRequired: verificationRequired,
        missingRequiredFacts: claimGate.missingFacts
      },
      { status: verificationRequired ? 409 : 402 }
    );
  }

  let hostname: string;
  try {
    hostname = normalizeCustomHostname(parsed.data.hostname);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid hostname" }, { status: 400 });
  }

  const existingDomain = await repository.getDomainByHostname(hostname);
  if (existingDomain) {
    if (existingDomain.siteId === parsed.data.siteId) return NextResponse.json(existingDomain);
    return NextResponse.json({ error: "Hostname is already connected to another site." }, { status: 409 });
  }

  const domain = await repository.registerDomain({ ...parsed.data, hostname });
  if (!domain) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  return NextResponse.json(domain);
}

function manualCustomDomainsAllowed() {
  if (process.env.LODESTA_ALLOW_MANUAL_CUSTOM_DOMAINS === "true") return true;
  return process.env.NODE_ENV !== "production" && process.env.LODESTA_REQUIRE_AUTH !== "true";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const unauthorized = siteId ? await requireAdminOrSiteOwner(request, siteId) : await requireAdmin(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({ domains: await repository.listDomains(siteId) });
}
