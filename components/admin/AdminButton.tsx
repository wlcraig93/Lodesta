import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type AdminButtonVariant = "primary" | "secondary" | "ghost";
type AdminButtonSize = "sm" | "md";

type AdminButtonBaseProps = {
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
  className?: string;
};

type AdminButtonProps = AdminButtonBaseProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  };

type AdminButtonLinkProps = AdminButtonBaseProps & {
  href: string;
  children: ReactNode;
  prefetch?: boolean;
};

type AdminButtonAnchorProps = AdminButtonBaseProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  };

export function AdminButton({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: AdminButtonProps) {
  return (
    <button className={adminButtonClassName(variant, size, className)} {...props}>
      {children}
    </button>
  );
}

export function AdminButtonLink({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: AdminButtonLinkProps) {
  return (
    <Link className={adminButtonClassName(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}

export function AdminButtonAnchor({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: AdminButtonAnchorProps) {
  return (
    <a className={adminButtonClassName(variant, size, className)} {...props}>
      {children}
    </a>
  );
}

export function AdminButtonRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={["admin-button-row", className].filter(Boolean).join(" ")}>{children}</div>;
}

function adminButtonClassName(variant: AdminButtonVariant, size: AdminButtonSize, className?: string) {
  return ["admin-button", `admin-button-${variant}`, `admin-button-${size}`, className].filter(Boolean).join(" ");
}
