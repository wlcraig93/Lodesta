"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminNavItem = {
  href: string;
  label: string;
};

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="admin-nav" aria-label="Admin">
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
  if (href === "/admin/site-generations") return pathname === href || pathname.startsWith("/admin/site-generations/");
  if (href === "/admin/runs") return pathname === href || pathname.startsWith("/admin/runs/");
  if (href === "/settings") return pathname === href || pathname.startsWith("/settings/");
  if (href === "/outbound") return pathname === href || pathname.startsWith("/outbound/");
  return pathname === href;
}
