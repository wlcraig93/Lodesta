/*
 * Starter shell: a working header, desktop navigation, phone menu and footer.
 * It is a starting point, not a template. Restyle, restructure or replace any
 * part of it for this business; only keep the behaviors noted below working.
 */
import type { ReactNode } from "react";
import { BusinessName, NavigationDisclosure } from "#lodesta-sdk";
import { RequiredDestinations } from "./required-destinations";

export type NavigationItem = { label: string; path: string };

export type Theme = "trade-bold" | "clean-pro" | "warm-local" | "premium-studio" | "fresh-modern";

/*
 * theme picks a design direction from library/themes.css. brand replaces the
 * text name with the official logo (<Asset>) when one exists. headerAction is
 * the always-visible primary action (call, request, book).
 */
export function SiteShell({ navigation, theme = "clean-pro", brand, headerAction, children }: {
  navigation: NavigationItem[];
  theme?: Theme;
  brand?: ReactNode;
  headerAction?: { label: string; href: string };
  children: ReactNode;
}) {
  return (
    <div className={`site theme-${theme}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="/">
            {brand ?? <BusinessName as="span" className="brand-name" />}
          </a>
          <nav className="desktop-nav" aria-label="Primary">
            {navigation.map((item) => (
              <a key={item.path} href={item.path}>{item.label}</a>
            ))}
          </nav>
          <div className="header-end">
            {headerAction ? <a className="header-action" href={headerAction.href}>{headerAction.label}</a> : null}
            {/* The platform opens, closes and positions this panel below the header.
                Style its contents freely, but do not set position, top or inset on
                the panel: that competes with the platform and hides the links. */}
            <NavigationDisclosure
              id="primary-navigation"
              behavior="modal"
              label="Primary"
              className="mobile-nav"
              toggleClassName="menu-toggle"
              panelClassName="menu-panel"
              navClassName="menu-links"
              trigger={(
                <span className="menu-icon" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              )}
            >
              {navigation.map((item) => (
                <a key={item.path} href={item.path}>{item.label}</a>
              ))}
              <RequiredDestinations />
            </NavigationDisclosure>
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="container footer-inner">
          <BusinessName as="p" className="footer-name" />
          <nav className="footer-nav" aria-label="Footer">
            {navigation.map((item) => (
              <a key={item.path} href={item.path}>{item.label}</a>
            ))}
            <RequiredDestinations />
          </nav>
        </div>
      </footer>
    </div>
  );
}
