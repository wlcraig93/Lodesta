import type { Metadata } from "next";
import "./product-tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lodesta",
  description: "Lodesta powers your business's website for you."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
