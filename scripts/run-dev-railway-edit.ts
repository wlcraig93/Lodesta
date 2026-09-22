import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const origin = "https://dev.lodesta.com";
const slug = "pristine-example-led-full-site-luna-d4a7ab10-b8cb8af53866";
const ownerUserId = "203f7351-fbd2-410e-bc77-240f9376c2ee";
const marker = "Railway dev cutover note";
const supabaseUrl = required("SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: userResult, error: userError } = await admin.auth.admin.getUserById(ownerUserId);
if (userError) throw userError;
const email = userResult.user?.email;
assert(email, "Owner account has no email.");
const { data: link, error: linkError } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { redirectTo: `${origin}/auth/callback?next=/workspace/${slug}/editor` }
});
if (linkError) throw linkError;
const actionLink = link.properties?.action_link;
assert(actionLink, "Magic link was not returned.");
const cookies = await sessionCookies(actionLink);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
let finished = false;
try {
  await page.context().addCookies(cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    url: origin,
    httpOnly: cookie.httpOnly,
    secure: true,
    sameSite: cookie.sameSite
  })));
  console.log("opening editor");
  await page.goto(`${origin}/workspace/${encodeURIComponent(slug)}/editor`, { waitUntil: "domcontentloaded" });
  const composer = page.locator(".site-agent-compose textarea");
  await composer.waitFor({ timeout: 30_000 });
  const before = await workspace(page);
  const previous = new Set((before.runs ?? []).map((run) => run.id).filter(Boolean));
  const active = (before.runs ?? []).find((run) => run.status === "queued" || run.status === "running");
  if (active) throw new Error(`An authoring run is already ${active.status}.`);
  await composer.fill(`Add the exact visible text "${marker}" once in the homepage footer. Keep it as a small standalone note and make no other content changes.`);
  await page.getByRole("button", { name: "Build requested change" }).click();
  console.log("edit submitted");
  const deadline = Date.now() + 25 * 60_000;
  let latest = before;
  while (Date.now() < deadline) {
    await page.waitForTimeout(10_000);
    latest = await workspace(page);
    const run = (latest.runs ?? []).find((item) => item.id && !previous.has(item.id));
    if (!run) continue;
    console.log(`${new Date().toISOString().slice(11, 19)} run ${run.id} ${run.status} ${run.stage ?? ""}`);
    if (!["succeeded", "failed", "needs_input", "cancelled"].includes(run.status ?? "")) continue;
    if (run.status !== "succeeded") throw new Error(`Edit ended as ${run.status}.`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.frameLocator('iframe[title="Website preview"]').getByText(marker, { exact: false }).waitFor({ timeout: 60_000 });
    console.log("PASS");
    finished = true;
    break;
  }
  if (!finished) throw new Error("Edit timed out.");
} finally {
  await browser.close();
}

function required(name: string) {
  const value = process.env[name]?.trim();
  assert(value, `${name} is required.`);
  return value;
}

async function workspace(page: import("playwright").Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/site-agent/sessions?siteId=site_canary_b8cb8af5386698462ebfdc9a21f5c052", { cache: "no-store" });
    if (!response.ok) throw new Error(`Workspace request returned ${response.status}.`);
    return response.json() as Promise<{ runs?: Array<{ id?: string; status?: string; stage?: string }> }>;
  });
}

async function sessionCookies(actionLink: string) {
  const verification = await fetch(actionLink, { redirect: "manual" });
  assert(verification.status >= 300 && verification.status < 400, `Magic link returned ${verification.status}.`);
  const redirect = verification.headers.get("location");
  assert(redirect, "Magic link omitted its redirect.");
  const target = new URL(redirect);
  const parameters = target.hash ? new URLSearchParams(target.hash.slice(1)) : target.searchParams;
  const accessToken = parameters.get("access_token");
  const refreshToken = parameters.get("refresh_token");
  assert(accessToken && refreshToken, "Magic link omitted its session.");
  const writes: Array<{ name: string; value: string; httpOnly: boolean; sameSite: "Strict" | "Lax" | "None" }> = [];
  const auth = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => [],
      setAll: (next) => {
        for (const cookie of next) {
          const sameSite = cookie.options.sameSite;
          writes.push({
            name: cookie.name,
            value: cookie.value,
            httpOnly: cookie.options.httpOnly ?? false,
            sameSite: sameSite === "strict" ? "Strict" : sameSite === "none" ? "None" : "Lax"
          });
        }
      }
    }
  });
  const { error } = await auth.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) throw error;
  assert(writes.length > 0, "Session cookies were not created.");
  return writes;
}
