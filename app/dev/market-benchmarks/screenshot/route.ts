import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { readMarketBenchmarkScreenshot } from "@/lib/market-benchmark-artifacts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") notFound();

  const url = new URL(request.url);
  const screenshot = await readMarketBenchmarkScreenshot({
    runId: url.searchParams.get("runId") ?? "",
    siteId: url.searchParams.get("siteId") ?? "",
    viewport: url.searchParams.get("viewport") ?? "desktop"
  });
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
