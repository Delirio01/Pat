import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pat — Grok Console",
  description: "A sleek Jarvis-style Grok (xAI) chat console",
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
