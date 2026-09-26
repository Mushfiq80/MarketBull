import type { Metadata, Viewport } from "next";

import { Providers } from "@/components/shell/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "BABull", template: "%s · BABull" },
  description:
    "AI-assisted investment intelligence for the Dhaka Stock Exchange. Research and decision support — not investment advice.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0f" },
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
