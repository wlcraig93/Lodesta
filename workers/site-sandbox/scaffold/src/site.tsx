import { BusinessName } from "#lodesta-sdk";
import { SiteShell, type NavigationItem } from "./shell";
import { Hero } from "./library/sections";

const navigation: NavigationItem[] = [{ label: "Home", path: "/" }];

export const siteDefinition = {
  routes: [{
    path: "/",
    title: "New website",
    description: "A new website workspace.",
    element: (
      <SiteShell navigation={navigation} theme="clean-pro">
        <Hero variant="type" title={<BusinessName />} />
      </SiteShell>
    )
  }]
};
