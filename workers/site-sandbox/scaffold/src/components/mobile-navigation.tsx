/* @lodesta-recipe {"id":"mobile-navigation","version":1,"templateHash":"sha256:06b946e0891d8168ec3710613d2eaf556838ee1dbf56ba13a9d266792261c366"} */
import { type ReactNode } from "react";
import { NavigationDisclosure } from "#lodesta-sdk";
import { RequiredDestinations } from "../required-destinations";

export function MobileNavigation({
  children,
  action,
  id = "primary-navigation",
  label = "Primary"
}: {
  children: ReactNode;
  action?: ReactNode;
  id?: string;
  label?: string;
}) {
  return <NavigationDisclosure
    id={id}
    label={label}
    behavior="modal"
    className="recipe-mobile-navigation"
    toggleClassName="recipe-mobile-navigation__toggle"
    panelClassName="recipe-mobile-navigation__panel"
    navClassName="recipe-mobile-navigation__nav"
    trigger={<span className="recipe-mobile-navigation__artwork" aria-hidden="true"><span /><span /><span /></span>}
  >
    <div className="recipe-mobile-navigation__links">{children}</div>
    <div className="recipe-mobile-navigation__action"><RequiredDestinations />{action}</div>
  </NavigationDisclosure>;
}
