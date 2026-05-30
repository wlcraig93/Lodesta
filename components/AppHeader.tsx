import Link from "next/link";

export function AppHeader() {
  return (
    <header className="app-header">
      <Link className="app-brand" href="/" aria-label="Lodesta home">
        <img src="/lodesta-logo.png" alt="Lodesta" />
      </Link>
      <nav className="app-nav" aria-label="Primary navigation">
        <Link href="/">Home</Link>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/auth/login">Sign in</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
    </header>
  );
}
