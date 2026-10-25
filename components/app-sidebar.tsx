"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Download,
  FolderGit2,
  LayoutTemplate,
  ListTree,
  Plug,
  Settings2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** pathname to match (defaults to href) */
  pathname: string;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

function item(label: string, href: string, icon: LucideIcon): NavItem {
  return { label, href, icon, pathname: href };
}

const SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      item("Tasks", "/", ListTree),
      item("Flows", "/flows", Workflow),
      item("Import tasks", "/tasks/import", Download),
      item("Templates", "/templates", LayoutTemplate),
    ],
  },
  {
    label: "Settings",
    items: [
      item("General", "/settings", Settings2),
      item("Repositories", "/settings/repositories", FolderGit2),
      item("Integrations", "/settings/integrations", Plug),
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* workspace identity */}
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-[15px] text-background">
            <Workflow size={14} strokeWidth={2.2} />
          </span>
          <span className="text-[13.5px] font-semibold tracking-tight text-sidebar-foreground">
            DevFlow
          </span>
        </Link>
      </div>

      {/* sections */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {SECTIONS.map((section) => (
          <SidebarSection key={section.label} label={section.label}>
            {section.items.map((nav) => {
              const active = pathname === nav.pathname;
              return (
                <SidebarLink
                  key={nav.href}
                  nav={nav}
                  active={active}
                />
              );
            })}
          </SidebarSection>
        ))}
      </nav>

      {/* environment context */}
      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success/80" />
          Local workspace
        </div>
      </div>
    </aside>
  );
}

function SidebarSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-1 px-2.5 text-[10.5px] font-medium uppercase tracking-[1.2px] text-muted-foreground/60">
        {label}
      </div>
      <div className="grid gap-0.5">{children}</div>
    </div>
  );
}

function SidebarLink({ nav, active }: { nav: NavItem; active: boolean }) {
  const Icon = nav.icon;
  return (
    <Link
      href={nav.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon
        size={15}
        className={cn("shrink-0", active ? "opacity-100" : "opacity-70")}
      />
      <span className="truncate">{nav.label}</span>
    </Link>
  );
}
