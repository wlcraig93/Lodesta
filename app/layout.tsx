import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SMB Presence Autopilot",
  description: "AI-first managed websites and local-presence optimization for small businesses."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
