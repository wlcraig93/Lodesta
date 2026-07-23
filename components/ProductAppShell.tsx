"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AccountActionList, AccountIdentity, AccountMenu, type AccountAction } from "@/components/AccountMenu";
import type { OwnerWorkspaceAccessMode } from "@/lib/page-access";
import type { OwnerWorkspaceSiteOption } from "@/lib/owner-workspace";

type ProductAppShellProps = {
  children: ReactNode;
  site?: OwnerWorkspaceSiteOption;
  sites: OwnerWorkspaceSiteOption[];
  accessMode: OwnerWorkspaceAccessMode;
  canAccessAdmin: boolean;
  tokenAccess?: boolean;
  accountLabel: string;
  accountEmail?: string;
  authConfigured: boolean;
};

const websiteNavigation = [
  { key: "overview", label: "Overview", suffix: "", icon: HomeIcon },
  { key: "website", label: "Website", suffix: "/website", icon: WebsiteIcon },
  { key: "inbox", label: "Inbox", suffix: "/inbox", icon: InboxIcon },
  { key: "results", label: "Results", suffix: "/results", icon: ResultsIcon },
  { key: "business", label: "Business info", suffix: "/business", icon: BusinessIcon }
] as const;

const SHELL_STORAGE_KEY = "lodesta:product-app-shell:v1";

export function ProductAppShell({
  children,
  site,
  sites,
  accessMode,
  canAccessAdmin,
  tokenAccess = false,
  accountLabel,
  accountEmail,
  authConfigured
}: ProductAppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreSheetRef = useRef<HTMLDivElement>(null);
  const base = site ? `/workspace/${site.slug}` : "/account";
  const websiteHref = site ? `${base}/website` : undefined;
  const focusedEditor = Boolean(websiteHref && (pathname === websiteHref || pathname.startsWith(`${websiteHref}/`)));
  const compactNavigation = focusedEditor || (ready && collapsed);
  const adminPreview = accessMode === "platform_admin_preview";
  const sessionLabel = tokenAccess ? "Token session" : adminPreview ? "Admin preview" : accessMode === "local_open" ? "Local development" : "Owner account";
  const accountActions = productAccountActions({ base, siteSlug: site?.slug, canAccessAdmin, tokenAccess, authConfigured, accountEmail });

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SHELL_STORAGE_KEY);
      setCollapsed(stored === "collapsed" || (!stored && window.matchMedia("(max-width: 1180px)").matches));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const sheet = moreSheetRef.current;
    const focusable = () => [...(sheet?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    focusable()[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreTriggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [moreOpen]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try { window.localStorage.setItem(SHELL_STORAGE_KEY, next ? "collapsed" : "expanded"); } catch { /* Storage can be unavailable. */ }
      return next;
    });
  }

  function closeMore() {
    setMoreOpen(false);
    moreTriggerRef.current?.focus();
  }

  return (
    <div
      className="owner-workspace-shell product-app-shell"
      data-collapsed={compactNavigation ? "true" : undefined}
      data-shell-mode={focusedEditor ? "focused-editor" : undefined}
      data-ready={ready ? "true" : undefined}
      data-has-site={site ? "true" : "false"}
    >
      <a className="owner-workspace-skip" href="#product-app-main">Skip to content</a>
      <aside className="owner-workspace-sidebar">
        <div className="owner-workspace-brand-row">
          <Link
            className="owner-workspace-brand"
            href="/account"
            aria-label={focusedEditor ? "All websites" : "Lodesta account"}
            data-sidebar-tooltip={focusedEditor ? "All websites" : undefined}
          >
            <img src="/brand/lodesta-mark.svg" alt="" />
            <span>Lodesta</span>
          </Link>
          {!focusedEditor ? (
            <button
              className="owner-workspace-collapse"
              type="button"
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              data-sidebar-tooltip={collapsed ? "Expand navigation" : undefined}
              onClick={toggleCollapsed}
            >
              <CollapseIcon collapsed={collapsed} />
            </button>
          ) : null}
        </div>

        <WebsiteSwitcher site={site} sites={sites} compact={compactNavigation} adminPreview={adminPreview} />

        {site ? (
          <nav className="owner-workspace-nav" aria-label="Website workspace">
            {websiteNavigation.map((item) => {
              const href = `${base}${item.suffix}`;
              const active = item.key === "overview" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  aria-label={compactNavigation ? item.label : undefined}
                  data-sidebar-tooltip={compactNavigation ? item.label : undefined}
                >
                  <Icon />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        ) : null}

        <div className="owner-workspace-sidebar-bottom">
          {site ? (
            <Link
              className="owner-workspace-settings-link"
              href={`${base}/settings`}
              aria-current={pathname.startsWith(`${base}/settings`) ? "page" : undefined}
              aria-label={compactNavigation ? "Website settings" : undefined}
              data-sidebar-tooltip={compactNavigation ? "Website settings" : undefined}
            >
              <SettingsIcon />
              <span>Website settings</span>
            </Link>
          ) : null}
          <AccountMenu label={accountLabel} sessionLabel={sessionLabel} actions={accountActions} compact={compactNavigation} />
        </div>
      </aside>

      <header className="owner-workspace-mobile-header">
        <Link className="owner-workspace-mobile-brand" href="/account" aria-label="Lodesta account"><img src="/brand/lodesta-mark.svg" alt="" /></Link>
        <WebsiteSwitcher site={site} sites={sites} compact={false} adminPreview={adminPreview} />
        {site ? site.published ? <a className="owner-workspace-live-link" href={`/sites/${site.slug}`} target="_blank" rel="noreferrer">Live</a> : <span className="owner-workspace-draft-label">Draft</span> : <span className="owner-workspace-draft-label">Account</span>}
      </header>

      <div className="owner-workspace-content" id="product-app-main">{children}</div>

      {site ? (
        <nav className="owner-workspace-mobile-nav" aria-label="Website workspace">
          {websiteNavigation.slice(0, 4).map((item) => {
            const href = `${base}${item.suffix}`;
            const active = item.key === "overview" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
            const Icon = item.icon;
            return <Link key={item.key} href={href} aria-current={active ? "page" : undefined}><Icon /><span>{item.label}</span></Link>;
          })}
          <MoreButton buttonRef={moreTriggerRef} open={moreOpen} active={pathname.startsWith(`${base}/business`) || pathname.startsWith(`${base}/settings`)} onClick={() => setMoreOpen((value) => !value)} />
        </nav>
      ) : (
        <nav className="owner-workspace-mobile-nav product-account-mobile-nav" aria-label="Account">
          <Link href="/account" aria-current={pathname === "/account" ? "page" : undefined}><AllWebsitesIcon /><span>Websites</span></Link>
          <Link href="/account/onboarding" aria-current={pathname.startsWith("/account/onboarding") ? "page" : undefined}><AddIcon /><span>Add website</span></Link>
          <Link href="/account/settings" aria-current={pathname === "/account/settings" ? "page" : undefined}><AccountIcon /><span>Account</span></Link>
          <MoreButton buttonRef={moreTriggerRef} open={moreOpen} active={false} onClick={() => setMoreOpen((value) => !value)} />
        </nav>
      )}

      {moreOpen ? (
        <div className="owner-workspace-mobile-sheet" role="dialog" aria-modal="true" aria-label="More product options">
          <button className="owner-workspace-sheet-backdrop" type="button" aria-label="Close menu" onClick={closeMore} />
          <div ref={moreSheetRef}>
            <header><strong>{site?.name ?? "Your Lodesta account"}</strong><button type="button" onClick={closeMore} aria-label="Close menu">×</button></header>
            {site ? <Link href={`${base}/business`} onClick={() => setMoreOpen(false)}><BusinessIcon /><span>Business info</span></Link> : null}
            {site ? <Link href={`${base}/settings`} onClick={() => setMoreOpen(false)}><SettingsIcon /><span>Website settings</span></Link> : null}
            <Link href="/account" onClick={() => setMoreOpen(false)}><AllWebsitesIcon /><span>All websites</span></Link>
            <Link href="/account/onboarding" onClick={() => setMoreOpen(false)}><AddIcon /><span>Add website</span></Link>
            {sites.map((option) => <Link href={`/workspace/${option.slug}`} key={option.id} onClick={() => setMoreOpen(false)}><WebsiteIcon /><span>{option.name}</span></Link>)}
            <section className="owner-workspace-mobile-account" aria-label="Account">
              <AccountIdentity label={accountLabel} sessionLabel={sessionLabel} />
              <AccountActionList actions={accountActions} onAction={() => setMoreOpen(false)} />
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WebsiteSwitcher({ site, sites, compact, adminPreview }: { site?: OwnerWorkspaceSiteOption; sites: OwnerWorkspaceSiteOption[]; compact: boolean; adminPreview: boolean }) {
  const content = site
    ? <><span className="owner-workspace-site-avatar" aria-hidden="true">{initials(site.name)}</span><span className="owner-workspace-site-copy"><strong>{site.name}</strong><small>{adminPreview ? "Admin preview" : site.published ? "Live website" : humanStatus(site.status)}</small></span></>
    : <><span className="owner-workspace-site-avatar" aria-hidden="true"><AllWebsitesIcon /></span><span className="owner-workspace-site-copy"><strong>All websites</strong><small>{sites.length ? `${sites.length} connected` : "Start with your first site"}</small></span></>;
  return (
    <details className="owner-workspace-site-switcher product-website-switcher" data-admin-preview={adminPreview ? "true" : undefined}>
      <summary
        aria-label={compact ? `Switch website. Current: ${site?.name ?? "All websites"}` : undefined}
        data-sidebar-tooltip={compact ? site?.name ?? "All websites" : undefined}
      >
        {content}
        <ChevronIcon />
      </summary>
      <div>
        <span>Websites</span>
        <Link href="/account" aria-current={!site ? "page" : undefined}><span className="owner-workspace-site-avatar" aria-hidden="true"><AllWebsitesIcon /></span><span><strong>All websites</strong><small>Account overview</small></span></Link>
        {sites.map((option) => <Link href={`/workspace/${option.slug}`} key={option.id} aria-current={option.id === site?.id ? "page" : undefined}><span className="owner-workspace-site-avatar" aria-hidden="true">{initials(option.name)}</span><span><strong>{option.name}</strong><small>{option.published ? "Live" : humanStatus(option.status)}</small></span></Link>)}
        <Link href="/account/onboarding"><span className="owner-workspace-site-avatar" aria-hidden="true"><AddIcon /></span><span><strong>Add website</strong><small>Create a private draft</small></span></Link>
      </div>
    </details>
  );
}

function MoreButton({ buttonRef, open, active, onClick }: { buttonRef: RefObject<HTMLButtonElement | null>; open: boolean; active: boolean; onClick(): void }) {
  return <button ref={buttonRef} type="button" aria-expanded={open} aria-haspopup="dialog" className={open || active ? "is-active" : ""} onClick={onClick}><MoreIcon /><span>More</span></button>;
}

function productAccountActions(input: { base: string; siteSlug?: string; canAccessAdmin: boolean; tokenAccess: boolean; authConfigured: boolean; accountEmail?: string }): AccountAction[] {
  const actions: AccountAction[] = [];
  if (!input.tokenAccess) actions.push({ id: "account-settings", kind: "link", label: "Account settings", href: "/account/settings", section: "account", icon: "account" });
  if (input.canAccessAdmin && !input.tokenAccess) actions.push({ id: "admin-console", kind: "link", label: "Admin console", href: input.siteSlug ? `/admin/sites/${input.siteSlug}` : "/admin/sites", section: "context", icon: "admin" });
  if (input.authConfigured && input.accountEmail && !input.tokenAccess) actions.push({ id: "sign-out", kind: "form", label: "Sign out", action: "/auth/logout", section: "session", icon: "sign-out" });
  else if (input.authConfigured && !input.tokenAccess) actions.push({ id: "sign-in", kind: "link", label: "Sign in", href: `/auth/login?next=${encodeURIComponent(input.base)}`, section: "session", icon: "sign-in" });
  else actions.push({ id: "session-note", kind: "note", label: input.tokenAccess ? "Authenticated by admin token." : "Local development access.", section: "session" });
  return actions;
}

function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "WS"; }
function humanStatus(value: string) { return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
type IconProps = { collapsed?: boolean };
function Icon({ children }: { children: ReactNode }) { return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>; }
function HomeIcon() { return <Icon><path d="m4 10 8-6 8 6v9H8v-6h8v6" /></Icon>; }
function WebsiteIcon() { return <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></Icon>; }
function InboxIcon() { return <Icon><path d="M4 5h16v14H4zM4 14h5l2 2h2l2-2h5" /></Icon>; }
function ResultsIcon() { return <Icon><path d="M5 19V9m7 10V5m7 14v-7" /></Icon>; }
function BusinessIcon() { return <Icon><path d="M4 20V7l8-3 8 3v13M8 10h2m4 0h2M8 14h2m4 0h2M10 20v-3h4v3" /></Icon>; }
function SettingsIcon() { return <Icon><circle cx="12" cy="12" r="3" /><path d="M19 14.5l1.4 1.1-2 3.4-1.8-.7a7 7 0 0 1-2.1 1.2l-.3 1.9h-4l-.3-1.9a7 7 0 0 1-2.1-1.2L6 19l-2-3.4 1.4-1.1a7 7 0 0 1 0-2.5L4 10.9 6 7.5l1.8.7A7 7 0 0 1 9.9 7l.3-1.9h4l.3 1.9a7 7 0 0 1 2.1 1.2l1.8-.7 2 3.4-1.4 1.1a7 7 0 0 1 0 2.5Z" /></Icon>; }
function MoreIcon() { return <Icon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon>; }
function ChevronIcon() { return <Icon><path d="m8 10 4 4 4-4" /></Icon>; }
function CollapseIcon({ collapsed }: IconProps) { return <Icon><path d="M4 5h16v14H4zM9 5v14" />{collapsed ? <path d="m13 9 3 3-3 3" /> : <path d="m16 9-3 3 3 3" />}</Icon>; }
function AllWebsitesIcon() { return <Icon><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></Icon>; }
function AddIcon() { return <Icon><path d="M12 5v14M5 12h14" /></Icon>; }
function AccountIcon() { return <Icon><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></Icon>; }
