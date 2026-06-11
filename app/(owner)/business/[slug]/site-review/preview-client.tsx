"use client";

import { OwnerSitePreview } from "@/components/OwnerSitePreview";

export function OwnerSitePreviewClient({
  businessName,
  slug,
  versionId,
  pages
}: {
  businessName: string;
  slug: string;
  versionId: string;
  pages: { slug: string; title: string }[];
}) {
  return (
    <OwnerSitePreview
      businessName={businessName}
      pages={pages}
      buildSrc={(pageSlug) =>
        `/editor/${slug}/preview${pageSlug ? `/${pageSlug}` : ""}?versionId=${encodeURIComponent(versionId)}`
      }
    />
  );
}
