import "./load-env";

import { createServer } from "node:http";
import { extname } from "node:path";
import {
  configuredSiteEvidenceStore,
  readCanonicalAuthoringEvidenceRegistry,
  verifyCanonicalAuthoringEvidenceBundle
} from "../packages/site-evidence";

const runId = process.argv.find((arg) => arg.startsWith("--run="))?.slice("--run=".length);
const port = Number(process.argv.find((arg) => arg.startsWith("--port="))?.slice("--port=".length) ?? "4178");
if (!runId) throw new Error("Pass --run=<decisive-run-id>.");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Viewer port is invalid.");
const { registry } = await readCanonicalAuthoringEvidenceRegistry();
const entry = registry.runs.find((run) => run.runId === runId);
if (!entry?.archive) throw new Error(`Evidence for ${runId} is not sealed.`);
const blob = await configuredSiteEvidenceStore().get(entry.archive.key);
if (!blob) throw new Error(`Evidence archive ${entry.archive.key} is unavailable.`);
const bundle = verifyCanonicalAuthoringEvidenceBundle(blob.bytes);
const files = new Map(bundle.files.map((file) => [file.path, Buffer.from(file.contentBase64, "base64")]));

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ accepted: false, evidenceViewer: true, mutationRejected: true }));
    return;
  }
  const path = archivePath(url.pathname);
  const bytes = files.get(path);
  if (!bytes) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("Archived evidence route not found.");
    return;
  }
  response.writeHead(200, {
    "content-type": contentType(path),
    "content-length": String(bytes.byteLength),
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'"
  });
  if (request.method === "HEAD") response.end();
  else response.end(bytes);
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});
process.stdout.write(`${JSON.stringify({
  ok: true,
  runId,
  origin: `http://127.0.0.1:${port}`,
  files: files.size,
  analyticsAndForms: "mutations-rejected"
})}\n`);

function archivePath(pathname: string) {
  if (pathname.startsWith("/_lodesta/runtime/")) return "runtime/runtime.js";
  if (pathname.startsWith("/_lodesta/fonts/")) return `fonts/original/${decodeURIComponent(pathname.split("/").at(-1) ?? "")}`;
  if (pathname.startsWith("/_lodesta/assets/")) {
    const revisionId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
    return [...files.keys()].find((path) => path.startsWith(`assets/by-revision/${revisionId}.`))
      ?? `assets/by-revision/${revisionId}`;
  }
  const clean = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, "");
  if (!clean) return "artifact/index.html";
  const direct = `artifact/${clean}`;
  if (files.has(direct)) return direct;
  if (files.has(`${direct}/index.html`)) return `${direct}/index.html`;
  return direct;
}

function contentType(path: string) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".woff2": "font/woff2"
  } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
}
