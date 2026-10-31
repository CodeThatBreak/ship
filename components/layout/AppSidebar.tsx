"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import {
  Blocks,
  FolderGit2,
  LayoutTemplate,
  ListTree,
  Plug,
  Settings2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { APP_ROUTES } from "@/constants/routes";
import { pickActiveNavHref } from "./utils/activeNavHref";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { APP_SHELL } from "./constants/shell";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const item = (label: string, href: string, icon: LucideIcon): NavItem => ({
  label,
  href,
  icon,
});

const SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      item("Tasks", APP_ROUTES.TASKS, ListTree),
      item("Flows", APP_ROUTES.FLOWS, Workflow),
      item("Templates", APP_ROUTES.TEMPLATES, LayoutTemplate),
      item("Template Nodes", APP_ROUTES.TEMPLATE_NODES, Blocks),
    ],
  },
  {
    label: "Settings",
    items: [
      item("General", APP_ROUTES.SETTINGS, Settings2),
      item("Repositories", APP_ROUTES.SETTINGS_REPOSITORIES, FolderGit2),
      item("Integrations", APP_ROUTES.SETTINGS_INTEGRATIONS, Plug),
    ],
  },
];

const ALL_NAV_ITEMS = SECTIONS.flatMap((section) => section.items);

export const AppSidebar = () => {
  const pathname = usePathname();
  const activeHref = useMemo(
    () => pickActiveNavHref(pathname, ALL_NAV_ITEMS),
    [pathname],
  );

  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <Link
          href={APP_ROUTES.TASKS}
          className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-[15px] text-background">
            <Workflow size={14} strokeWidth={2.2} />
          </span>
          <span className="text-[13.5px] font-semibold tracking-tight text-sidebar-foreground">
            {APP_SHELL.PRODUCT_NAME}
          </span>
        </Link>
      </div>

      <ScrollArea className="flex-1" viewportClassName="[&>nav]:px-2 [&>nav]:py-4">
        <nav>
          {SECTIONS.map((section) => (
            <SidebarSection key={section.label} label={section.label}>
              {section.items.map((nav) => (
                <SidebarLink
                  key={nav.href}
                  nav={nav}
                  active={activeHref === nav.href}
                />
              ))}
            </SidebarSection>
          ))}
        </nav>
      </ScrollArea>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success/80" />
          {APP_SHELL.WORKSPACE_LABEL}
        </div>
      </div>
    </aside>
  );
};

const SidebarSection = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => {
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-1 px-2.5 text-[10.5px] font-medium uppercase tracking-[1.2px] text-muted-foreground/60">
        {label}
      </div>
      <div className="grid gap-0.5">{children}</div>
    </div>
  );
};

const SidebarLink = ({ nav, active }: { nav: NavItem; active: boolean }) => {
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
};
