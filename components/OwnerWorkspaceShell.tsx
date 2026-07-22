"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccountActionList, AccountIdentity, AccountMenu, type AccountAction } from "@/components/AccountMenu";
import type { OwnerWorkspaceAccessMode } from "@/lib/page-access";
import type { OwnerWorkspaceSiteOption } from "@/lib/owner-workspace";

type WorkspaceShellProps = {
  children: ReactNode;
  site: OwnerWorkspaceSiteOption;
  sites: OwnerWorkspaceSiteOption[];
  accessMode: OwnerWorkspaceAccessMode;
  canAccessAdmin: boolean;
  tokenAccess: boolean;
  accountLabel: string;
  accountEmail?: string;
  authConfigured: boolean;
};

const nav = [
  { key: "home", label: "Home", suffix: "", icon: HomeIcon },
  { key: "website", label: "Website", suffix: "/website", icon: WebsiteIcon },
  { key: "inbox", label: "Inbox", suffix: "/inbox", icon: InboxIcon },
  { key: "results", label: "Results", suffix: "/results", icon: ResultsIcon },
  { key: "business", label: "Business", suffix: "/business", icon: BusinessIcon }
] as const;

const SHELL_STORAGE_KEY = "lodesta:owner-workspace-shell:v1";

export function OwnerWorkspaceShell({
  children,
  site,
  sites,
  accessMode,
  canAccessAdmin,
  tokenAccess,
  accountLabel,
  accountEmail,
  authConfigured
}: WorkspaceShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const base = `/workspace/${site.slug}`;
  const adminPreview = accessMode === "platform_admin_preview";
  const sessionLabel = tokenAccess ? "Token session" : adminPreview ? "Admin preview" : accessMode === "local_open" ? "Local development" : "Owner account";
  const accountActions = ownerAccountActions({
    base,
    siteSlug: site.slug,
    canAccessAdmin,
    tokenAccess,
    authConfigured,
    accountEmail
  });

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
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMoreOpen(false);
      moreTriggerRef.current?.focus();
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

  return (
    <div className="owner-workspace-shell" data-collapsed={ready && collapsed ? "true" : undefined} data-ready={ready ? "true" : undefined}>
      <a className="owner-workspace-skip" href="#owner-workspace-main">Skip to workspace</a>
      <aside className="owner-workspace-sidebar">
        <div className="owner-workspace-brand-row">
          <Link className="owner-workspace-brand" href={base} aria-label="Lodesta home">
            <img src="/brand/lodesta-mark.svg" alt="" />
            <span>Lodesta</span>
          </Link>
          <button className="owner-workspace-collapse" type="button" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} onClick={toggleCollapsed}>
            <CollapseIcon collapsed={collapsed} />
          </button>
        </div>

        <SiteIdentity site={site} sites={sites} compact={collapsed} adminPreview={adminPreview} />

        <nav className="owner-workspace-nav" aria-label="Site workspace">
          {nav.map((item) => {
            const href = `${base}${item.suffix}`;
            const active = item.key === "home" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
            const Icon = item.icon;
            return <Link key={item.key} href={href} aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined}><Icon /><span>{item.label}</span></Link>;
          })}
        </nav>

        <div className="owner-workspace-sidebar-bottom">
          <Link className="owner-workspace-settings-link" href={`${base}/settings`} aria-current={pathname.startsWith(`${base}/settings`) ? "page" : undefined} title={collapsed ? "Settings" : undefined}>
            <SettingsIcon /><span>Settings</span>
          </Link>
          <AccountMenu
            label={accountLabel}
            sessionLabel={sessionLabel}
            actions={accountActions}
          />
        </div>
      </aside>

      <header className="owner-workspace-mobile-header">
        <Link className="owner-workspace-mobile-brand" href={base} aria-label="Lodesta home"><img src="/brand/lodesta-mark.svg" alt="" /></Link>
        <SiteIdentity site={site} sites={sites} compact={false} adminPreview={adminPreview} />
        {site.published ? <a className="owner-workspace-live-link" href={`/sites/${site.slug}`} target="_blank" rel="noreferrer">Live</a> : <span className="owner-workspace-draft-label">Draft</span>}
      </header>

      <div className="owner-workspace-content" id="owner-workspace-main">{children}</div>

      <nav className="owner-workspace-mobile-nav" aria-label="Site workspace">
        {nav.slice(0, 4).map((item) => {
          const href = `${base}${item.suffix}`;
          const active = item.key === "home" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
          const Icon = item.icon;
          return <Link key={item.key} href={href} aria-current={active ? "page" : undefined}><Icon /><span>{item.label}</span></Link>;
        })}
        <button ref={moreTriggerRef} type="button" aria-expanded={moreOpen} aria-haspopup="dialog" className={moreOpen || pathname.startsWith(`${base}/business`) || pathname.startsWith(`${base}/settings`) ? "is-active" : ""} onClick={() => setMoreOpen((value) => !value)}><MoreIcon /><span>More</span></button>
      </nav>

      {moreOpen ? (
        <div className="owner-workspace-mobile-sheet" role="dialog" aria-modal="true" aria-label="More workspace options">
          <button className="owner-workspace-sheet-backdrop" type="button" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <div>
            <header><strong>{site.name}</strong><button type="button" onClick={() => setMoreOpen(false)} aria-label="Close menu">×</button></header>
            <Link href={`${base}/business`} onClick={() => setMoreOpen(false)}><BusinessIcon /><span>Business</span></Link>
            <Link href={`${base}/settings`} onClick={() => setMoreOpen(false)}><SettingsIcon /><span>Settings</span></Link>
            {sites.length > 1 ? <Link href="/account" onClick={() => setMoreOpen(false)}><SwitchIcon /><span>Switch site</span></Link> : null}
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

function SiteIdentity({ site, sites, compact, adminPreview }: { site: OwnerWorkspaceSiteOption; sites: OwnerWorkspaceSiteOption[]; compact: boolean; adminPreview: boolean }) {
  const content = <><span className="owner-workspace-site-avatar" aria-hidden="true">{initials(site.name)}</span><span className="owner-workspace-site-copy"><strong>{site.name}</strong><small>{adminPreview ? "Admin preview" : site.published ? "Live website" : humanStatus(site.status)}</small></span></>;
  if (sites.length <= 1) return <div className="owner-workspace-site-identity" data-admin-preview={adminPreview ? "true" : undefined} title={compact ? site.name : undefined}>{content}</div>;
  return (
    <details className="owner-workspace-site-switcher" data-admin-preview={adminPreview ? "true" : undefined}>
      <summary title={compact ? site.name : undefined}>{content}<ChevronIcon /></summary>
      <div>
        <span>Switch website</span>
        {sites.map((option) => <Link href={`/workspace/${option.slug}`} key={option.id} aria-current={option.id === site.id ? "page" : undefined}><span className="owner-workspace-site-avatar" aria-hidden="true">{initials(option.name)}</span><span><strong>{option.name}</strong><small>{option.published ? "Live" : humanStatus(option.status)}</small></span></Link>)}
      </div>
    </details>
  );
}

function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "WS"; }
function humanStatus(value: string) { return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }

function ownerAccountActions({
  base,
  siteSlug,
  canAccessAdmin,
  tokenAccess,
  authConfigured,
  accountEmail
}: {
  base: string;
  siteSlug: string;
  canAccessAdmin: boolean;
  tokenAccess: boolean;
  authConfigured: boolean;
  accountEmail?: string;
}): AccountAction[] {
  const actions: AccountAction[] = [];
  if (!tokenAccess) {
    actions.push({ id: "account-settings", kind: "link", label: "Account settings", href: "/account/settings", section: "account", icon: "account" });
  }
  if (canAccessAdmin && !tokenAccess) {
    actions.push({ id: "admin-console", kind: "link", label: "Admin console", href: `/admin/sites/${siteSlug}`, section: "context", icon: "admin" });
  }
  if (authConfigured && accountEmail && !tokenAccess) {
    actions.push({ id: "sign-out", kind: "form", label: "Sign out", action: "/auth/logout", section: "session", icon: "sign-out" });
  } else if (authConfigured && !accountEmail && !tokenAccess) {
    actions.push({ id: "sign-in", kind: "link", label: "Sign in", href: `/auth/login?next=${encodeURIComponent(base)}`, section: "session", icon: "sign-in" });
  } else {
    actions.push({ id: "session-note", kind: "note", label: tokenAccess ? "Authenticated by admin token." : "Local development access.", section: "session" });
  }
  return actions;
}

type IconProps = { collapsed?: boolean };
function Icon({ children }: { children: ReactNode }) { return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>; }
function HomeIcon() { return <Icon><path d="m4 10 8-6 8 6v9H8v-6h8v6" /></Icon>; }
function WebsiteIcon() { return <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></Icon>; }
function InboxIcon() { return <Icon><path d="M4 5h16v14H4zM4 14h5l2 2h2l2-2h5" /></Icon>; }
function ResultsIcon() { return <Icon><path d="M5 19V9m7 10V5m7 14v-7" /></Icon>; }
function BusinessIcon() { return <Icon><path d="M4 20V7l8-3 8 3v13M8 10h2m4 0h2M8 14h2m4 0h2M10 20v-3h4v3" /></Icon>; }
function SettingsIcon() { return <Icon><circle cx="12" cy="12" r="3" /><path d="M19 14.5l1.4 1.1-2 3.4-1.8-.7a7 7 0 0 1-2.1 1.2l-.3 1.9h-4l-.3-1.9a7 7 0 0 1-2.1-1.2L6 19l-2-3.4 1.4-1.1a7 7 0 0 1 0-2.5L4 10.9 6 7.5l1.8.7A7 7 0 0 1 9.9 7l.3-1.9h4l.3 1.9a7 7 0 0 1 2.1 1.2l1.8-.7 2 3.4-1.4 1.1a7 7 0 0 1 0 2.5Z" /></Icon>; }
function SwitchIcon() { return <Icon><path d="m7 7-3 3 3 3M4 10h14m-1 1 3 3-3 3M20 14H6" /></Icon>; }
function MoreIcon() { return <Icon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon>; }
function ChevronIcon() { return <Icon><path d="m8 10 4 4 4-4" /></Icon>; }
function CollapseIcon({ collapsed }: IconProps) { return <Icon><path d="M4 5h16v14H4zM9 5v14" />{collapsed ? <path d="m13 9 3 3-3 3" /> : <path d="m16 9-3 3 3 3" />}</Icon>; }
