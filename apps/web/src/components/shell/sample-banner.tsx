import { TriangleAlert } from "lucide-react";

/**
 * Non-dismissible amber bar shown whenever any displayed series is sample-tagged.
 *
 * Deliberately impossible to dismiss: the whole point of the sample-data
 * firewall (ADR 0007) is that you cannot forget you are looking at fake numbers.
 */
export function SampleBanner({ detail }: { detail?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--status-warning)]/40 bg-[var(--status-warning)]/15 px-4 py-1.5 text-xs">
      <TriangleAlert className="size-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden />
      <span>
        <strong>Sample data.</strong> Some values on this screen are generated for UI development and
        are not real market data. Backtests refuse to run on it.
        {detail ? ` ${detail}` : ""}
      </span>
      <code className="text-muted-foreground ml-auto hidden shrink-0 text-[10px] sm:block">
        npm run db:clear:sample
      </code>
    </div>
  );
}
