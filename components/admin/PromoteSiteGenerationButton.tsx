"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

type PromoteResponse = {
  site?: {
    slug?: string;
  };
  error?: string;
};

export function PromoteSiteGenerationButton({
  generationId,
  promoted,
  disabledReason
}: {
  generationId: string;
  promoted: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function promote() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/site-generations/${generationId}/promote`, {
        method: "POST"
      });
      const payload = (await response.json().catch(() => ({}))) as PromoteResponse;
      if (!response.ok) {
        setError(payload.error ?? "Promotion failed.");
        return;
      }
      if (payload.site?.slug) router.push(`/admin/sites/${payload.site.slug}`);
      else router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Promotion failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AdminButton variant="primary" type="button" onClick={promote} disabled={submitting || Boolean(disabledReason)}>
        {promoted ? "Open managed site" : submitting ? "Promoting..." : "Promote to managed site"}
      </AdminButton>
      {disabledReason ? <p className="form-status warning-text">{disabledReason}</p> : null}
      {error ? <p className="form-status error-text">{error}</p> : null}
    </div>
  );
}
