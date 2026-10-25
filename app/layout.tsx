import "./globals.css";
import type { Metadata } from "next";

import { AppProviders } from "./providers";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "DevFlow — SDLC Cockpit",
  description: "Single-screen developer SDLC: Jira → Plan → Build → MR → CI → Review",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>
          <TooltipProvider>{children}</TooltipProvider>
        </AppProviders>
      </body>
    </html>
  );
}
