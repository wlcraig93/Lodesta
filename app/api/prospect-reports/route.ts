import { NextResponse } from "next/server";
import { z } from "zod";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import {
  createOrReuseProspectReport,
  ProspectReportGenerationError
} from "@/packages/acquisition/prospect-report-generation";
import { publicProspectReport } from "@/packages/acquisition/prospect-reports";

export const runtime = "nodejs";

const createReportSchema = z.object({
  query: z.string().trim().min(2).max(300)
}).strict();

export async function POST(request: Request) {
  const limit = rateLimit(request, {
    bucket: "prospect_report_create",
    limit: 8,
    windowMs: 60 * 60_000
  });
  if (!limit.ok) return limit.response;

  const parsed = createReportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Invalid report request" }, { status: 400 }),
      limit
    );
  }

  try {
    const created = await createOrReuseProspectReport({
      query: parsed.data.query,
      accessPolicy: "email_gate"
    });
    return applyRateLimitHeaders(
      NextResponse.json(
        { report: publicProspectReport(created.report), reused: created.reused },
        { status: created.job ? 202 : 200 }
      ),
      limit
    );
  } catch (error) {
    const status = error instanceof ProspectReportGenerationError ? error.status : 500;
    const message = error instanceof ProspectReportGenerationError
      ? error.publicMessage
      : "Unable to create the report.";
    return applyRateLimitHeaders(NextResponse.json({ error: message }, { status }), limit);
  }
}
