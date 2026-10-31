import { SettingsProvider } from "@/components/settings";

/** Shared data provider for the settings sub-routes (general / repositories / integrations). */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}
