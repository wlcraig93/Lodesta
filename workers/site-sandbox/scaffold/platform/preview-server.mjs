import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const defaultRoot = "/workspace/site/active/dist";
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

export function createPreviewServer(root = process.env.LODESTA_PREVIEW_ROOT || defaultRoot) {
  return createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
      response.end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url || "/", "http://lodesta-preview.local").pathname);
    } catch {
      response.writeHead(400, { "cache-control": "no-store" });
      response.end();
      return;
    }

    const rootPath = resolve(root);
    const requestedPath = resolve(rootPath, `.${pathname}`);
    if (requestedPath !== rootPath && !requestedPath.startsWith(`${rootPath}${sep}`)) {
      response.writeHead(404, { "cache-control": "no-store" });
      response.end();
      return;
    }

    const exactFile = await readableFile(requestedPath);
    const filePath = exactFile ? requestedPath : extname(pathname) ? undefined : resolve(rootPath, "index.html");
    if (!filePath || !await readableFile(filePath)) {
      response.writeHead(404, { "cache-control": "no-store" });
      response.end();
      return;
    }

    const headers = {
      "cache-control": "no-store",
      "content-type": contentTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream"
    };
    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const stream = createReadStream(filePath);
    stream.on("error", () => response.destroy());
    stream.pipe(response);
  });
}

async function readableFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = argument("--host", "0.0.0.0");
  const port = Number.parseInt(argument("--port", "4173"), 10);
  createPreviewServer().listen(port, host);
}
