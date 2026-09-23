/*
 * Starter homepage: replace it with this business's site. It uses only
 * platform-bound content so it builds for any business. Compose real pages
 * from library/sections.tsx and the templates in library/pages.tsx, for
 * example a homepage with the managed form in the first viewport:
 *
 *   <Hero variant="form" title="..." lead="..." proof={...}
 *     formTitle="Request an estimate" form={<LeadForm id="<form id from the build input>" />} />
 *
 * and inner routes such as <ServicePage />, <ContactPage /> and
 * <LegalDocument /> (library/legal.tsx).
 */
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
