import localFont from "next/font/local";

export const lodestaProductSans = localFont({
  src: [
    {
      path: "./fonts/InterVariable.woff2",
      style: "normal",
      weight: "100 900"
    },
    {
      path: "./fonts/InterVariable-Italic.woff2",
      style: "italic",
      weight: "100 900"
    }
  ],
  display: "swap",
  preload: true,
  variable: "--font-lodesta-product-sans"
});

export const lodestaBrandSans = localFont({
  src: [
    {
      path: "./fonts/Figtree[wght].woff2",
      style: "normal",
      weight: "100 900"
    },
    {
      path: "./fonts/Figtree-Italic[wght].woff2",
      style: "italic",
      weight: "100 900"
    }
  ],
  display: "swap",
  preload: true,
  variable: "--font-lodesta-brand-sans"
});
