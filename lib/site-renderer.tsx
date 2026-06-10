import * as React from "react";
import type { BusinessLocationRecord, BusinessProfile, Experiment, ExtensionModel, PageModel, SiteLocationBinding, SiteModel, SiteVersion, Theme } from "./models";
import { getPublishedVersion } from "./sample-data";
import { SiteRendererV3 } from "./site-renderer-v3";

type SiteRendererProps = {
  business: BusinessProfile;
  site: SiteModel;
  extensions: ExtensionModel;
  version?: SiteVersion;
  locations?: BusinessLocationRecord[];
  locationBindings?: SiteLocationBinding[];
  page?: PageModel;
  pageSlug?: string;
  theme?: Theme;
  experiments?: Experiment[];
  tracking?: boolean;
  formsEnabled?: boolean;
};

export function SiteRenderer({
  business,
  site,
  extensions,
  version: selectedVersion,
  locations,
  locationBindings,
  page,
  pageSlug,
  experiments = [],
  tracking = true,
  formsEnabled = true
}: SiteRendererProps) {
  const version = selectedVersion ?? getPublishedVersion(site);
  if (version.rendererVersion !== "layout-v3") {
    throw new Error(`Unsupported generated-site renderer version: ${version.rendererVersion}. Lodesta generated sites now render through layout-v3 only.`);
  }
  return (
    <SiteRendererV3
      business={business}
      site={site}
      version={version}
      locations={locations}
      locationBindings={locationBindings}
      pageSlug={page?.slug ?? pageSlug}
      experiments={experiments}
      tracking={tracking}
      formsEnabled={formsEnabled}
    />
  );
}
