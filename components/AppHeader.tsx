import Link from "next/link";

export function AppHeader() {
  return (
    <header className="app-header marketing-header">
      <Link className="app-brand" href="/" aria-label="Lodesta home">
        <img src="/lodesta-logo.png" alt="Lodesta" />
      </Link>
      <nav className="app-nav" aria-label="Primary navigation">
        <Link href="/#product">Product</Link>
        <Link href="/#operations">Operations</Link>
        <Link className="app-nav-primary" href="/auth/login">
          Sign in
        </Link>
      </nav>
    </header>
  );
}
