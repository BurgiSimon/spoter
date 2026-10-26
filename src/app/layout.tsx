import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Spoter: swipe your way to new music", template: "%s · Spoter" },
  description:
    "Spoter learns your music taste from your Spotify library and listening history, then lets you swipe, duel and rank songs to find music you'll love.",
  applicationName: "Spoter",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0b0b10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
