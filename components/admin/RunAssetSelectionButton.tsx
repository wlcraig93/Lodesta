"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

type AssetSelectionResponse = {
  summary?: string;
  error?: string;
};

export function RunAssetSelectionButton({
  siteId,
  versionId
}: {
  siteId: string;
  versionId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runAudit() {
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sites/asset-selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, versionId })
      });
      const payload = (await response.json().catch(() => ({}))) as AssetSelectionResponse;
      if (!response.ok) {
        setMessage(payload.error ?? "Asset selection failed.");
        return;
      }
      setMessage(payload.summary ?? "Asset selection audit ran.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Asset selection failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AdminButton variant="secondary" type="button" onClick={runAudit} disabled={submitting}>
        {submitting ? "Running..." : "Audit asset selection"}
      </AdminButton>
      {message ? <p className="form-status">{message}</p> : null}
    </div>
  );
}
