import type { Metadata } from "next";
import { ThemePreferenceManager } from "@/components/ThemePreferenceControl";
import { lodestaProductSans } from "./fonts";
import "./product-tokens.css";
import "./globals.css";

const themeBootstrap = `(()=>{const k="lodesta:theme-preference";let p="system";try{const v=localStorage.getItem(k);if(v==="light"||v==="dark"||v==="system")p=v}catch{}const d=p==="system"?matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light":p;const r=document.documentElement;r.dataset.themePreference=p;r.dataset.theme=d;r.style.colorScheme=d})()`;

export const metadata: Metadata = {
  title: "Lodesta",
  description: "Lodesta powers your business's website for you."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={lodestaProductSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <ThemePreferenceManager />
        {children}
      </body>
    </html>
  );
}
