import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { parseAdminRunQuery } from "@/lib/admin-run-query";
import { sitePlatformRepository } from "@/packages/platform-data";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const parsed = parseAdminRunQuery(new URL(request.url).searchParams);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid run inventory query", issues: parsed.error.issues }, { status: 400 });
  }
  const page = await sitePlatformRepository.listAgentRunAdminPage(parsed.data);
  return NextResponse.json({ ...page, limit: parsed.data.limit ?? 50, offset: parsed.data.offset ?? 0 });
}
