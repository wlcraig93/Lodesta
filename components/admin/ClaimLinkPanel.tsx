"use client";

import { useState } from "react";

/** Creates or revokes the claim link for an unowned prospect project. */
export function ClaimLinkPanel({ siteId }: { siteId: string }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string }>();
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function call(method: "POST" | "DELETE") {
    setPending(true);
    setStatus("");
    try {
      const response = await fetch(`/api/admin/sites/${encodeURIComponent(siteId)}/claim-link`, { method });
      const result = await response.json().catch(() => ({})) as { url?: string; expiresAt?: string; revoked?: number; error?: string };
      if (!response.ok) {
        setStatus(result.error ?? "The claim link could not be changed.");
        return;
      }
      if (method === "POST" && result.url && result.expiresAt) {
        setLink({ url: result.url, expiresAt: result.expiresAt });
        setStatus("New link created. Earlier open links for this site no longer work.");
      } else {
        setLink(undefined);
        setStatus(`${result.revoked ?? 0} open link${result.revoked === 1 ? "" : "s"} revoked.`);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="button-row">
        <button className="button secondary" type="button" disabled={pending} onClick={() => void call("POST")}>Create claim link</button>
        <button className="button danger-secondary" type="button" disabled={pending} onClick={() => void call("DELETE")}>Revoke open links</button>
      </div>
      {link ? <p><code>{link.url}</code><br /><small className="muted">Shown once. Expires {new Date(link.expiresAt).toLocaleString()}.</small></p> : null}
      {status ? <p className="form-status" role="status">{status}</p> : null}
    </div>
  );
}
