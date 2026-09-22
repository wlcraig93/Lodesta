/*
 * Starter shell: a working header, desktop navigation, phone menu and footer.
 * It is a starting point, not a template. Restyle, restructure or replace any
 * part of it for this business; only keep the behaviors noted below working.
 */
import type { ReactNode } from "react";
import { BusinessName, NavigationDisclosure } from "#lodesta-sdk";
import { RequiredDestinations } from "./required-destinations";

export type NavigationItem = { label: string; path: string };

export function SiteShell({ navigation, children }: { navigation: NavigationItem[]; children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="/">
            <BusinessName as="span" className="brand-name" />
          </a>
          <nav className="desktop-nav" aria-label="Primary">
            {navigation.map((item) => (
              <a key={item.path} href={item.path}>{item.label}</a>
            ))}
          </nav>
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
    </>
  );
}
