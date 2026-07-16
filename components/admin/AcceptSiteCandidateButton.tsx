"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

type AcceptResponse = {
  site?: {
    slug?: string;
  };
  error?: string;
};

export function AcceptSiteCandidateButton({
  candidateId,
  accepted,
  disabledReason,
  intendedSiteId
}: {
  candidateId: string;
  accepted: boolean;
  disabledReason?: string;
  intendedSiteId?: string;
}) {
  const router = useRouter();
  const reasonId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledReasonId = disabledReason ? reasonId : undefined;

  async function accept() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/site-candidates/${candidateId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intendedSiteId ? { mode: "site_version", siteId: intendedSiteId } : { mode: "new_site" })
      });
      const payload = (await response.json().catch(() => ({}))) as AcceptResponse;
      if (!response.ok) {
        setError(payload.error ?? "Acceptance failed.");
        return;
      }
      if (payload.site?.slug) router.push(`/admin/sites/${payload.site.slug}`);
      else router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Acceptance failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AdminButton
        variant="primary"
        type="button"
        onClick={accept}
        disabled={submitting || Boolean(disabledReason)}
        aria-describedby={disabledReasonId}
        title={disabledReason}
      >
        {accepted ? "Open managed site" : submitting ? "Promoting..." : intendedSiteId ? "Promote as new version" : "Promote to managed site"}
      </AdminButton>
      {disabledReason ? (
        <span id={disabledReasonId} className="visually-hidden">
          {disabledReason}
        </span>
      ) : null}
      {error ? <p className="form-status error-text">{error}</p> : null}
    </div>
  );
}
