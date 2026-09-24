import {
  firstPartySupportFromSnapshotPages,
  isAffiliateOrTrackingLink,
  type FirstPartySupport
} from "@/packages/business-data/first-party-support";
import type { SitePublicBuildInput, SourceSnapshot, SourceSnapshotPage } from "@/packages/site-contracts";
import { validatePublicHostname } from "@/lib/url-safety";

/**
 * First-party support over the build's retained website sources: fetched
 * pages on each website snapshot's own host, for snapshots the public build
 * input references. Shared by the sanitizer allowlists and fact markers.
 */
export function firstPartySupportForBuild(
  buildInput: SitePublicBuildInput,
  snapshots: readonly SourceSnapshot[],
  pages: readonly SourceSnapshotPage[]
): FirstPartySupport {
  const sourceHosts = new Map(snapshots.flatMap((snapshot) => {
    if (!buildInput.sourceSnapshotIds.includes(snapshot.id) || snapshot.sourceType !== "website" || !snapshot.sourceUrl) return [];
    return [[snapshot.id, new URL(snapshot.sourceUrl).hostname.toLowerCase().replace(/^www\./, "")] as const];
  }));
  return firstPartySupportFromSnapshotPages(pages, { sourceHosts });
}

/**
 * Outbound links the business itself shows on its retained pages (partners,
 * BBB, financing, associations), excluding injected spam pages (the support
 * index never returns them), affiliate/click-tracking links, and non-public
 * hosts. Unsafe schemes never reach this list: it holds only http(s) URLs.
 */
export function firstPartyOutboundHrefs(support: FirstPartySupport) {
  return support.outboundLinks().filter((href) => {
    if (isAffiliateOrTrackingLink(href)) return false;
    try {
      return validatePublicHostname(new URL(href).hostname).ok;
    } catch {
      return false;
    }
  });
}
