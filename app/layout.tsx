import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./editorial.css";
import "./motion.css";
import "./phone-app.css";
import "./home.css";

export const metadata: Metadata = {
  title: "Prithvi FC",
  description: "Prithvi FC. Club football, Winter league, match results and player profiles.",
  applicationName: "HRSC–Prithvi",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "HRSC–Prithvi", statusBarStyle: "default" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#e6f2df",
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
