import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Agentic Operations CRM", template: "%s · Agentic Operations CRM" },
  description: "Operations CRM — Milestone 1 local prototype (synthetic data only).",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
