/* @lodesta-recipe {"id":"mobile-navigation","version":1,"templateHash":"sha256:61ababcf6c33c09b1de27d97fdf99ebde624197bace6328907f441d644da993f"} */
import { type ReactNode } from "react";
import { NavigationDisclosure } from "#lodesta-sdk";

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
    {action ? <div className="recipe-mobile-navigation__action">{action}</div> : null}
  </NavigationDisclosure>;
}
