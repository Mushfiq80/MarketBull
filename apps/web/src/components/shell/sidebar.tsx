"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BarChart3, Building2, Database, Eye, LayoutDashboard,
  ListOrdered, MessageSquare, Search, Wallet,
} from "lucide-react";

import { cn } from "@/lib/utils";

const NAV = [
  { group: "Market", items: [
    { href: "/", label: "Market home", Icon: LayoutDashboard },
    { href: "/rankings", label: "Rankings", Icon: ListOrdered },
    { href: "/regime", label: "Bull market watch", Icon: Activity },
  ]},
  { group: "Research", items: [
    { href: "/issuers", label: "Companies", Icon: Building2 },
    { href: "/research/why-moving", label: "Why moving?", Icon: Search },
    { href: "/chat", label: "Research chat", Icon: MessageSquare },
  ]},
  { group: "Mine", items: [
    { href: "/watchlist", label: "Watchlist", Icon: Eye },
    { href: "/portfolio", label: "Portfolio", Icon: Wallet },
  ]},
  { group: "Operate", items: [
    { href: "/admin/data-quality", label: "Data quality", Icon: Database },
    { href: "/admin/models", label: "Models", Icon: BarChart3 },
  ]},
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="bg-card hidden w-60 shrink-0 flex-col border-r lg:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="bg-primary text-primary-foreground grid size-6 place-items-center rounded font-bold">
          B
        </span>
        <span className="font-semibold tracking-tight">BABull</span>
        <span className="text-muted-foreground ml-auto text-[10px] uppercase">DSE</span>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {NAV.map((section) => (
          <div key={section.group} className="mb-3">
            <p className="text-muted-foreground px-2 py-1 text-[10px] font-medium tracking-wider uppercase">
              {section.group}
            </p>
            <ul className="space-y-0.5">
              {section.items.map(({ href, label, Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-secondary text-foreground font-medium"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="text-muted-foreground border-t p-3 text-[10px] leading-relaxed">
        Private R&D. Research and decision support — not investment advice, not a signal service.
      </div>
    </aside>
  );
}
