import { NextResponse } from "next/server";
import { readStoredAsset } from "@/lib/asset-storage";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

// Storage paths are deterministic (`{candidateId}/qa-screenshot-{viewport}`,
// see persistPrimaryQaScreenshot), so this route skips the candidate-bundle
// fetch entirely — at queue scale that's dozens of multi-MB reads per view.
// JPEG above-the-fold thumbnails are preferred; PNG covers older captures.
const storedNamePreference = [
  "qa-screenshot-desktop.jpg",
  "qa-screenshot-desktop.png",
  "qa-screenshot-tablet.png",
  "qa-screenshot-mobile.png"
] as const;

export async function GET(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { candidateId } = await params;
  for (const name of storedNamePreference) {
    const asset = await readStoredAsset(`${candidateId}/${name}`);
    if (!asset) continue;
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "Content-Type": asset.mimeType,
        "Cache-Control": "private, max-age=3600"
      }
    });
  }
  return NextResponse.json({ error: "Screenshot not found" }, { status: 404 });
}
