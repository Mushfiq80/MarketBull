import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium tracking-wide uppercase transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        // Status palette — always paired with an icon + label, never colour alone.
        good: "border-[var(--status-good)]/30 bg-[var(--status-good)]/10 text-[var(--status-good)]",
        warning: "border-[var(--status-warning)]/30 bg-[var(--status-warning)]/10 text-[var(--status-warning)]",
        serious: "border-[var(--status-serious)]/30 bg-[var(--status-serious)]/10 text-[var(--status-serious)]",
        critical: "border-[var(--status-critical)]/30 bg-[var(--status-critical)]/10 text-[var(--status-critical)]",
        muted: "border-border bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
