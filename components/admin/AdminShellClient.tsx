"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccountActionList, AccountIdentity, AccountMenu, type AccountAction } from "@/components/AccountMenu";
import { ThemePreferenceControl } from "@/components/ThemePreferenceControl";

type AdminIconName = "sites" | "queue" | "authoring" | "outbound" | "settings" | "assessments" | "activity" | "bakeoff";
type AdminNavItem = { href: string; label: string; icon: AdminIconName };
type AdminNavGroup = { label: string; items: AdminNavItem[] };

const navigation: AdminNavGroup[] = [
  {
    label: "Build",
    items: [
      { href: "/admin/sites", label: "Manage sites", icon: "sites" },
      { href: "/admin/site-queue", label: "Review queue", icon: "queue" }
    ]
  },
  {
    label: "Operate",
    items: [
      { href: "/authoring-batches", label: "Authoring batches", icon: "authoring" },
      { href: "/outbound", label: "Outbound", icon: "outbound" },
      { href: "/settings", label: "Settings", icon: "settings" }
    ]
  },
  {
    label: "Debug",
    items: [
      { href: "/model-bakeoffs", label: "Model bake-offs", icon: "bakeoff" },
      { href: "/admin/assessments", label: "Assessments", icon: "assessments" },
      { href: "/admin/runs", label: "Activity", icon: "activity" }
    ]
  }
];

const mobilePrimary = [
  navigation[0].items[0],
  navigation[0].items[1],
  navigation[2].items[2]
];
const ADMIN_SHELL_STORAGE_KEY = "lodesta:admin-shell";

export function AdminShellClient({
  children,
  displayName,
  email,
  sessionLabel,
  accountActions
}: {
  children: ReactNode;
  displayName: string;
  email?: string;
  sessionLabel: string;
  accountActions: AccountAction[];
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreSheetRef = useRef<HTMLDivElement>(null);
  const compact = ready && collapsed;
  const activeItem = navigation.flatMap((group) => group.items).find((item) => isActivePath(pathname, item.href));

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(ADMIN_SHELL_STORAGE_KEY) === "collapsed");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const sheet = moreSheetRef.current;
    const focusable = () => [...(sheet?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [role="radio"], [tabindex]:not([tabindex="-1"])') ?? [])];
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
      try {
        window.localStorage.setItem(ADMIN_SHELL_STORAGE_KEY, next ? "collapsed" : "expanded");
      } catch {
        // Storage can be unavailable in hardened or private browsing contexts.
      }
      return next;
    });
  }

  function closeMore() {
    setMoreOpen(false);
    moreTriggerRef.current?.focus();
  }

  return (
    <div className="admin-shell" data-modern-shell="true" data-collapsed={compact ? "true" : undefined} data-ready={ready ? "true" : undefined}>
      <a className="admin-shell-skip" href="#admin-shell-main">Skip to admin content</a>
      <aside className="admin-sidebar">
        <div className="admin-brand-row">
          <Link className="admin-brand" href="/admin/sites" aria-label={compact ? "Lodesta admin" : undefined} data-sidebar-tooltip={compact ? "Lodesta admin" : undefined}>
            <img src="/brand/lodesta-mark.svg" alt="" />
            <span><strong>Lodesta</strong><small>Admin</small></span>
          </Link>
          <button className="admin-collapse" type="button" aria-label={compact ? "Expand navigation" : "Collapse navigation"} data-sidebar-tooltip={compact ? "Expand navigation" : undefined} onClick={toggleCollapsed}>
            <CollapseIcon collapsed={compact} />
          </button>
        </div>

        <div className="admin-nav-stack">
          {navigation.map((group) => (
            <section className="admin-nav-group" aria-label={`${group.label} navigation`} key={group.label}>
              <p>{group.label}</p>
              <nav className="admin-nav" aria-label={group.label}>
                {group.items.map((item) => (
                  <AdminNavLink item={item} compact={compact} active={isActivePath(pathname, item.href)} key={item.href} />
                ))}
              </nav>
            </section>
          ))}
        </div>

        <div className="admin-sidebar-bottom">
          <AccountMenu displayName={displayName} email={email} contextLabel={sessionLabel} actions={accountActions} compact={compact} />
        </div>
      </aside>

      <header className="admin-mobile-header">
        <Link href="/admin/sites" aria-label="Lodesta admin"><img src="/brand/lodesta-mark.svg" alt="" /></Link>
        <div><span>Admin</span><strong>{activeItem?.label ?? "Operations"}</strong></div>
      </header>

      <div className="admin-shell-main" id="admin-shell-main">{children}</div>

      <nav className="admin-mobile-nav" aria-label="Admin">
        {mobilePrimary.map((item) => (
          <AdminNavLink item={item} compact={false} active={isActivePath(pathname, item.href)} mobile key={item.href} />
        ))}
        <button ref={moreTriggerRef} type="button" aria-haspopup="dialog" aria-expanded={moreOpen} aria-label="More admin options" className={moreOpen || !mobilePrimary.some((item) => isActivePath(pathname, item.href)) ? "is-active" : undefined} onClick={() => setMoreOpen((current) => !current)}>
          <MoreIcon />
          <span>More</span>
        </button>
      </nav>

      {moreOpen ? (
        <div className="admin-mobile-sheet" role="dialog" aria-modal="true" aria-label="More admin options">
          <button className="admin-mobile-sheet-backdrop" type="button" aria-label="Close menu" onClick={closeMore} />
          <div ref={moreSheetRef}>
            <header><strong>Admin tools</strong><button type="button" aria-label="Close menu" onClick={closeMore}>×</button></header>
            <nav aria-label="More admin navigation">
              {navigation.flatMap((group) => group.items).filter((item) => !mobilePrimary.includes(item)).map((item) => (
                <Link href={item.href} aria-current={isActivePath(pathname, item.href) ? "page" : undefined} onClick={() => setMoreOpen(false)} key={item.href}>
                  <AdminIcon name={item.icon} /><span>{item.label}</span>
                </Link>
              ))}
            </nav>
            <section className="admin-mobile-account" aria-label="Account and appearance">
              <AccountIdentity displayName={displayName} email={email} contextLabel={sessionLabel} />
              <ThemePreferenceControl />
              <AccountActionList actions={accountActions} onAction={() => setMoreOpen(false)} />
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AdminNavLink({ item, compact, active, mobile = false }: { item: AdminNavItem; compact: boolean; active: boolean; mobile?: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={compact ? item.label : undefined}
      data-sidebar-tooltip={compact ? item.label : undefined}
      data-mobile-link={mobile ? "true" : undefined}
    >
      <AdminIcon name={item.icon} />
      <span>{mobile && item.href === "/admin/sites" ? "Sites" : mobile && item.href === "/admin/site-queue" ? "Queue" : item.label}</span>
    </Link>
  );
}

function isActivePath(pathname: string, href: string) {
  if (href === "/admin/sites") return pathname === href || pathname.startsWith("/admin/sites/");
  if (href === "/admin/site-queue") return pathname === href || pathname.startsWith("/admin/site-queue/");
  if (href === "/admin/runs") return pathname === href || pathname.startsWith("/admin/runs/");
  if (href === "/admin/assessments") return pathname === href || pathname.startsWith("/admin/assessments/");
  if (href === "/settings") return pathname === href || pathname.startsWith("/settings/");
  if (href === "/outbound") return pathname === href || pathname.startsWith("/outbound/");
  if (href === "/authoring-batches") return pathname === href || pathname.startsWith("/authoring-batches/");
  if (href === "/model-bakeoffs") return pathname === href || pathname.startsWith("/model-bakeoffs/");
  return pathname === href;
}

function AdminIcon({ name }: { name: AdminIconName }) {
  if (name === "queue") return <Icon><path d="M5 4h14v16H5zM8 9l2 2 5-5M8 16h8" /></Icon>;
  if (name === "authoring") return <Icon><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.5 7 17 10.5M5 5h5M7.5 2.5v5" /></Icon>;
  if (name === "outbound") return <Icon><path d="m3 11 18-8-7 18-3-7zM11 14l4-4" /></Icon>;
  if (name === "settings") return <Icon><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6.2L14.7 3h-5.4L9 6.2a8 8 0 0 0-1.5.9l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.5.9l.3 3.2h5.4l.3-3.2a8 8 0 0 0 1.5-.9l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" /></Icon>;
  if (name === "assessments") return <Icon><path d="M4 19V5h16v14zM8 15l2.5-3 2 2 3.5-5" /></Icon>;
  if (name === "activity") return <Icon><path d="M3 12h4l2-6 4 12 2-6h6" /></Icon>;
  if (name === "bakeoff") return <Icon><path d="M4 19h16M6 16V8h5v8M13 16V4h5v12M5 8h7M12 4h7" /></Icon>;
  return <Icon><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></Icon>;
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return <Icon><path d="M4 4h16v16H4zM9 4v16" />{collapsed ? <path d="m13 9 3 3-3 3" /> : <path d="m16 9-3 3 3 3" />}</Icon>;
}

function MoreIcon() {
  return <Icon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon>;
}

function Icon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
}
