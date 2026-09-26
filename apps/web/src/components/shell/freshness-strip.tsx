import { FreshnessBadge } from "@/components/evidence/freshness-badge";
import type { SourceStatus } from "@/lib/api/envelope";

/** Compact per-source freshness row in the top bar. */
export function FreshnessStrip({ status }: { status: SourceStatus }) {
  const entries = Object.entries(status);
  if (!entries.length) {
    return <span className="text-muted-foreground text-xs">No sources configured</span>;
  }
  // Worst state first — a failing source should not be hidden behind healthy ones.
  const order = { unavailable: 0, never_run: 1, stale: 2, restricted: 3, ok: 4 } as const;
  entries.sort((a, b) => order[a[1].state] - order[b[1].state]);

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto">
      {entries.slice(0, 5).map(([sourceId, s]) => (
        <FreshnessBadge key={sourceId} state={s.state} lagMinutes={s.lagMinutes} sourceId={sourceId} />
      ))}
    </div>
  );
}
