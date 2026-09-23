import type { Metadata } from "next";
import "./globals.css";
import "./editorial.css";
import "./motion.css";

export const metadata: Metadata = {
  title: "HRSC–Prithvi | Winter League",
  description: "Three teams. One winter ritual. Match results, player stats and player-of-the-day voting for HRSC–Prithvi.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
