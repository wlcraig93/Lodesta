"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminNavItem = {
  href: string;
  label: string;
};

export function AdminNav({ items, ariaLabel = "Admin" }: { items: AdminNavItem[]; ariaLabel?: string }) {
  const pathname = usePathname();

  return (
    <nav className="admin-nav" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function isActivePath(pathname: string, href: string) {
  if (href === "/admin/sites") return pathname === href || pathname.startsWith("/admin/sites/");
  if (href === "/admin/assets") return pathname === href || pathname.startsWith("/admin/assets/");
  if (href === "/admin/site-candidates") return pathname === href || pathname.startsWith("/admin/site-candidates/");
  if (href === "/admin/benchmark-sites") return pathname === href || pathname.startsWith("/admin/benchmark-sites/");
  if (href === "/admin/runs") return pathname === href || pathname.startsWith("/admin/runs/");
  if (href === "/settings") return pathname === href || pathname.startsWith("/settings/");
  if (href === "/outbound") return pathname === href || pathname.startsWith("/outbound/");
  return pathname === href;
}
