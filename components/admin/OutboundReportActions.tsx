"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AdminButton,
  AdminButtonAnchor,
  AdminButtonRow
} from "@/components/admin/AdminButton";

export function OutboundReportActions({
  prospectId,
  reportUrl,
  reportStatus,
  directAccess
}: {
  prospectId: string;
  reportUrl?: string;
  reportStatus?: string;
  directAccess: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"create" | "revoke" | null>(null);
  const [message, setMessage] = useState("");

  async function createReport() {
    if (pending) return;
    setPending("create");
    setMessage("Preparing the public report…");
    try {
      const response = await fetch(`/api/outbound/prospects/${encodeURIComponent(prospectId)}/report`, {
        method: "POST"
      });
      const payload = await response.json().catch(() => null) as { error?: string; reportUrl?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "The report could not be created.");
      setMessage("Report ready. Refreshing status…");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The report could not be created.");
    } finally {
      setPending(null);
    }
  }

  async function copyReportUrl() {
    if (!reportUrl) return;
    try {
      await navigator.clipboard.writeText(new URL(reportUrl, window.location.origin).href);
      setMessage("Report URL copied.");
    } catch {
      setMessage("Copy was unavailable. Open the report and copy its browser address.");
    }
  }

  async function revokeDirectAccess() {
    if (pending) return;
    setPending("revoke");
    setMessage("Revoking direct access…");
    try {
      const response = await fetch(`/api/outbound/prospects/${encodeURIComponent(prospectId)}/report`, {
        method: "DELETE"
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Direct access could not be revoked.");
      setMessage("Direct access revoked. The existing link now shows the email teaser.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Direct access could not be revoked.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="outbound-report-actions">
      <AdminButtonRow>
        <AdminButton size="sm" onClick={createReport} disabled={Boolean(pending)}>
          {pending === "create"
            ? "Preparing…"
            : reportStatus === "failed" || !directAccess
              ? "Create / refresh report"
              : "Refresh report"}
        </AdminButton>
        {directAccess && reportUrl ? (
          <>
            <AdminButtonAnchor
              size="sm"
              href={`/api/outbound/prospects/${encodeURIComponent(prospectId)}/report`}
              target="_blank"
              rel="noreferrer"
            >
              Open
            </AdminButtonAnchor>
            <AdminButton size="sm" onClick={copyReportUrl}>Copy URL</AdminButton>
            <AdminButtonAnchor
              size="sm"
              href={`/api/outbound/prospects/${encodeURIComponent(prospectId)}/report/qr`}
            >
              Download QR
            </AdminButtonAnchor>
            <AdminButton size="sm" variant="ghost" onClick={revokeDirectAccess} disabled={Boolean(pending)}>
              {pending === "revoke" ? "Revoking…" : "Revoke direct access"}
            </AdminButton>
          </>
        ) : null}
      </AdminButtonRow>
      {message ? <p className="admin-inline-status" role="status" aria-live="polite">{message}</p> : null}
    </div>
  );
}
