import { Database, Info, Lock, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

type Reason = "no_data" | "no_access" | "gated" | "not_computed";

const CONFIG: Record<Reason, { Icon: typeof Database; title: string; body: string; action?: { href: string; label: string } }> = {
  no_data: {
    Icon: Database,
    title: "No data ingested for this range yet",
    body:
      "This is not an empty result — nothing has been loaded. Run the DSE adapters, or seed sample data for UI work.",
    action: { href: "/admin/data-quality", label: "Open data quality console" },
  },
  no_access: {
    Icon: Lock,
    title: "Licensed source",
    body: "This data requires a commercial feed that is not connected in this build.",
  },
  gated: {
    Icon: ShieldAlert,
    title: "Excluded by a risk gate",
    body: "This instrument did not pass the eligibility gates for the selected horizon.",
  },
  not_computed: {
    Icon: Info,
    title: "Not computed yet",
    body: "Factors and scores have not been generated for this date. Run the compute pipeline.",
  },
};

/** Empty states say WHY. Never just "No results". */
export function EmptyState({
  reason,
  className,
  detail,
}: {
  reason: Reason;
  className?: string;
  detail?: string;
}) {
  const { Icon, title, body, action } = CONFIG[reason];
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <Icon className="text-muted-foreground size-6" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground max-w-md text-xs">{detail ?? body}</p>
      {action ? (
        <Link href={action.href} className="text-primary mt-1 text-xs hover:underline">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
