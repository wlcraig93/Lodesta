import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { configuredArtifactBlobStore } from "@/packages/site-artifacts";
import { sitePlatformRepository } from "@/packages/platform-data";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string; eventId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { runId, eventId } = await params;
  const event = await sitePlatformRepository.getAgentRunEvent(runId, eventId);
  if (!event) return payloadResponse({ error: "Run event not found" }, 404);
  if (!event.payloadRef || !event.payloadHash) {
    return payloadResponse({ eventId, state: "available", payload: null });
  }
  const blob = await configuredArtifactBlobStore().get(event.payloadRef);
  if (!blob) return payloadResponse({ eventId, state: "expired" });
  if (blob.contentHash !== event.payloadHash) return payloadResponse({ eventId, state: "integrity_error" });
  try {
    return payloadResponse({
      eventId,
      state: "available",
      payload: JSON.parse(blob.bytes.toString("utf8"))
    });
  } catch {
    return payloadResponse({ eventId, state: "integrity_error" });
  }
}

function payloadResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" }
  });
}
