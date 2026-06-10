import { NextResponse } from "next/server";
import { readMarketBenchmarkScreenshot } from "@/lib/market-benchmark-artifacts";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const screenshot = await readMarketBenchmarkScreenshot(inputFromRequest(request));
  if (!screenshot.ok) return NextResponse.json({ error: screenshot.error }, { status: screenshot.status });

  return new Response(responseBody(screenshot.bytes), {
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Type": screenshot.contentType
    }
  });
}

function responseBody(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function inputFromRequest(request: Request) {
  const url = new URL(request.url);
  return {
    runId: url.searchParams.get("runId") ?? "",
    siteId: url.searchParams.get("siteId") ?? "",
    viewport: url.searchParams.get("viewport") ?? "desktop"
  };
}
