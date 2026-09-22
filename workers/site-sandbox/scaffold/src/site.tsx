import { BusinessName } from "#lodesta-sdk";
import { SiteShell, type NavigationItem } from "./shell";

const navigation: NavigationItem[] = [{ label: "Home", path: "/" }];

export const siteDefinition = {
  routes: [{
    path: "/",
    title: "New website",
    description: "A new website workspace.",
    element: (
      <SiteShell navigation={navigation}>
        <section className="section">
          <div className="container">
            <h1><BusinessName /></h1>
          </div>
        </section>
      </SiteShell>
    )
  }]
};
