import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Every API route authorizes before it reads or changes account data. Public
// endpoints are listed here with the reason they need no account.
const publicRoutes: Record<string, string> = {
  "app/api/analytics/route.ts": "Published-site visitor analytics; validated against the live site and version.",
  "app/api/forms/submit/route.ts": "Published-site visitor inquiries; validated against the live site's published forms.",
  "app/api/domains/resolve/route.ts": "Middleware hostname resolution; returns only a site slug for a live domain.",
  "app/api/prospect-reports/route.ts": "Public Website Health Report request, rate limited.",
  "app/api/prospect-reports/[reportId]/route.ts": "Report status by unguessable report ID.",
  "app/api/prospect-reports/[reportId]/access/route.ts": "Report access by signed access grant.",
  "app/api/prospect-reports/[reportId]/lead/route.ts": "Requester's own email for the report link, rate limited.",
  "app/api/previews/[previewId]/session/route.ts": "Preview access by secret preview grant."
};
const authorization = /requireSiteOwner|requireAdminOrSiteOwner|requireAdmin\(|authorizedSiteActor|authorizedOperator|requireOwnerAccess|hasValidRecoveryWatchdogToken|getCurrentUser/;

async function routes(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory()
    ? routes(join(directory, entry.name))
    : Promise.resolve(entry.name === "route.ts" ? [join(directory, entry.name)] : [])))).flat();
}

const all = await routes("app/api");
const unauthorized: string[] = [];
for (const route of all) {
  if (publicRoutes[route]) continue;
  if (!authorization.test(await readFile(route, "utf8"))) unauthorized.push(route);
}
assert.deepEqual(unauthorized, [], `API routes without an authorization check: ${unauthorized.join(", ")}`);
for (const route of Object.keys(publicRoutes)) assert(all.includes(route), `Listed public route no longer exists: ${route}`);
console.log(JSON.stringify({ ok: true, routes: all.length, public: Object.keys(publicRoutes).length }));
