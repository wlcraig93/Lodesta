import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") notFound();
  const root = resolve(join(process.cwd(), ".design", "generation-review", "canonical-generation-review-v1"));
  const requested = new URL(request.url).searchParams.get("path") ?? "";
  const path = resolve(root, requested);
  if (!requested || (!path.startsWith(`${root}${sep}`) && path !== root)) return new Response("Capture not found", { status: 404 });
  const bytes = await readFile(path).catch(() => null);
  if (!bytes) return new Response("Capture not found", { status: 404 });
  const type = extname(path).toLowerCase() === ".jpg" || extname(path).toLowerCase() === ".jpeg" ? "image/jpeg" : "image/png";
  return new Response(bytes, { headers: { "Cache-Control": "no-store", "Content-Type": type, "X-Robots-Tag": "noindex, nofollow" } });
}
