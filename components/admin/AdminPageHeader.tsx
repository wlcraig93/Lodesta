import type { ReactNode } from "react";

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
  className
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={["admin-page-header", className].filter(Boolean).join(" ")}>
      <div className="admin-page-header-copy">
        {typeof eyebrow === "string" || typeof eyebrow === "number" ? <span className="badge">{eyebrow}</span> : eyebrow}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="admin-page-header-actions">{actions}</div> : null}
    </header>
  );
}
