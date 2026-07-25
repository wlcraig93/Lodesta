import { synchronizeSiteSandboxManifest } from "./site-sandbox-manifest";

const mode = process.argv.includes("--check") ? "check" : "write";
const result = await synchronizeSiteSandboxManifest({ mode });
process.stdout.write(`${JSON.stringify({ ok: true, mode, ...result })}\n`);
