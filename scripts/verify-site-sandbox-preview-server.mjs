import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPreviewServer } from "../workers/site-sandbox/scaffold/platform/preview-server.mjs";

const fixture = await mkdtemp(join(tmpdir(), "lodesta-preview-pointer-"));
const active = join(fixture, "active");
const next = join(fixture, "active.next");

try {
  await Promise.all([
    writeGeneration("old", "old generation"),
    writeGeneration("new", "new generation")
  ]);
  await symlink(join(fixture, "old"), active);

  const server = createPreviewServer(join(active, "dist"));
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object", "Preview server did not expose a local port.");
    const origin = `http://127.0.0.1:${address.port}`;
    assert.equal(await (await fetch(`${origin}/services`)).text(), "old generation", "Preview did not serve the active generation.");

    await symlink(join(fixture, "new"), next);
    await rename(next, active);
    await rm(join(fixture, "old"), { recursive: true, force: true });

    assert.equal(await (await fetch(`${origin}/services`)).text(), "new generation", "A running preview did not follow the promoted generation.");
    assert.equal((await fetch(`${origin}/missing.css`)).status, 404, "Missing assets incorrectly fell back to HTML.");
  } finally {
    await new Promise((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise()));
  }
} finally {
  await rm(fixture, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ ok: true, persistentPreview: "pass", atomicPointerRefresh: "pass" })}\n`);

async function writeGeneration(name, html) {
  const dist = join(fixture, name, "dist");
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, "index.html"), html);
}
