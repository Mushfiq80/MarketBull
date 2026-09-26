"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Menu, Search } from "lucide-react";

import { FreshnessStrip } from "@/components/shell/freshness-strip";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SourceStatus } from "@/lib/api/envelope";

export function Topbar({ sourceStatus }: { sourceStatus: SourceStatus }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");

  // "/" focuses search — the shortcut every terminal user reaches for.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="bg-background/80 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Menu">
        <Menu className="size-4" />
      </Button>

      <Link href="/" className="font-semibold lg:hidden">
        BABull
      </Link>

      <form
        className="relative max-w-sm flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) router.push(`/issuers?q=${encodeURIComponent(query.trim())}`);
        }}
      >
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ticker or company…   /"
          className="h-8 pl-8 text-sm"
          aria-label="Search companies"
        />
      </form>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden md:block">
          <FreshnessStrip status={sourceStatus} />
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
