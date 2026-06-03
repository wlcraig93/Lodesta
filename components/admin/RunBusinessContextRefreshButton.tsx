"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

type BusinessContextRefreshResponse = {
  summary?: string;
  error?: string;
};

export function RunBusinessContextRefreshButton({
  siteId,
  versionId
}: {
  siteId: string;
  versionId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runRefresh() {
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sites/business-context-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, versionId })
      });
      const payload = (await response.json().catch(() => ({}))) as BusinessContextRefreshResponse;
      if (!response.ok) {
        setMessage(payload.error ?? "Business context refresh failed.");
        return;
      }
      setMessage(payload.summary ?? "Business context refresh ran.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Business context refresh failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AdminButton variant="secondary" type="button" onClick={runRefresh} disabled={submitting}>
        {submitting ? "Running..." : "Refresh business context"}
      </AdminButton>
      {message ? <p className="form-status">{message}</p> : null}
    </div>
  );
}
