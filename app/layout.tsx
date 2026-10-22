import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DevFlow — SDLC Cockpit",
  description: "Single-screen developer SDLC: Jira → Plan → Build → MR → CI → Review",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
