import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="minimal-auth-shell"><Link href="/" aria-label="Lodesta home"><img src="/brand/lodesta-mark.svg" alt="" /><span>Lodesta</span></Link>{children}</div>;
}
