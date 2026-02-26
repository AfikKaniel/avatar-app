import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Your Personal Avatar",
  description: "Talk to an AI avatar that looks and sounds like you",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
