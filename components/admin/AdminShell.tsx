import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { href: "/admin/generate", label: "Generate" },
  { href: "/admin/runs", label: "Runs" },
  { href: "/admin/sites", label: "Sites" }
];

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/admin/generate">
          Lodesta Admin
        </Link>
        <nav className="admin-nav" aria-label="Admin">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="admin-shell-main">{children}</div>
    </div>
  );
}
