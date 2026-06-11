"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type PublishResponse = {
  ok?: boolean;
  error?: string;
  paymentRequired?: boolean;
  factVerificationRequired?: boolean;
  missingRequiredFacts?: string[];
};

export function OwnerPublishButton({
  siteId,
  slug,
  disabledReason
}: {
  siteId: string;
  slug: string;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpHref, setHelpHref] = useState<string | null>(null);

  async function publish() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setHelpHref(null);
    try {
      const response = await fetch("/api/sites/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, confirmed: true })
      });
      const payload = (await response.json().catch(() => ({}))) as PublishResponse;
      if (!response.ok) {
        if (payload.factVerificationRequired) {
          setError(
            payload.missingRequiredFacts?.length
              ? `Confirm these facts first: ${payload.missingRequiredFacts.join(", ")}.`
              : "Confirm your business facts before publishing."
          );
          setHelpHref(`/business/${slug}`);
        } else if (payload.paymentRequired) {
          setError("Finish claiming your site to publish it.");
          setHelpHref(`/claim/${slug}`);
        } else {
          setError(payload.error ?? "Publishing failed. Your Lodesta team has been notified.");
        }
        return;
      }
      router.refresh();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Publishing failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="owner-publish">
      <button
        className="button primary"
        type="button"
        onClick={publish}
        disabled={submitting || Boolean(disabledReason)}
        title={disabledReason}
      >
        {submitting ? "Publishing..." : "Approve and publish my site"}
      </button>
      {disabledReason ? <p className="owner-publish-note muted">{disabledReason}</p> : null}
      {error ? (
        <p className="form-status error-text">
          {error}
          {helpHref ? (
            <>
              {" "}
              <a href={helpHref}>Go there now</a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
