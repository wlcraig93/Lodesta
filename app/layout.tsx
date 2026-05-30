import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lodesta",
  description: "Lodesta powers your business's website for you."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <AppHeader />
          {children}
        </div>
      </body>
    </html>
  );
}
