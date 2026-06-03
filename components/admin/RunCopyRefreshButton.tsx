"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

type CopyRefreshResponse = {
  summary?: string;
  error?: string;
};

export function RunCopyRefreshButton({
  siteId,
  versionId,
  disabled
}: {
  siteId: string;
  versionId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runCopyRefresh() {
    if (submitting || disabled) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sites/copy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, versionId })
      });
      const payload = (await response.json().catch(() => ({}))) as CopyRefreshResponse;
      if (!response.ok) {
        setMessage(payload.error ?? "Copy refresh failed.");
        return;
      }
      setMessage(payload.summary ?? "Copy refresh audit ran.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Copy refresh failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AdminButton variant="secondary" type="button" onClick={runCopyRefresh} disabled={submitting || disabled}>
        {submitting ? "Running..." : "Run copy refresh"}
      </AdminButton>
      {message ? <p className="form-status">{message}</p> : null}
    </div>
  );
}
