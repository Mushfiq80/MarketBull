"use client";

import * as React from "react";
import { FileText, Link2, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { CLAIM_STATUS_LABELS, type ClaimStatus } from "@/lib/domain/states";
import { formatTimestamp } from "@/lib/format";

export type EvidenceItem = {
  id: string;
  kind: "document" | "computation" | "market_observation" | "external_link";
  summary: string;
  documentTitle?: string | null;
  pageRef?: string | null;
  url?: string | null;
  asOf?: string | null;
  sourceAuthority?: string | null;
  claimStatus?: ClaimStatus | null;
  rightsStatus?: string | null;
  computation?: { table: string; rowId: string; formulaVersion?: string } | null;
};

const CLAIM_VARIANT: Record<ClaimStatus, "good" | "warning" | "serious" | "muted"> = {
  confirmed_document: "good",
  attributed_report: "warning",
  allegation: "serious",
  analyst_interpretation: "muted",
  model_inference: "muted",
};

/**
 * The evidence drawer. Every factual claim in a report resolves here — either to
 * a source document with a page reference, or to a stored computation with its
 * formula version.
 */
export function EvidenceSheet({
  title,
  items,
  children,
}: {
  title: string;
  items: EvidenceItem[];
  children: React.ReactNode;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className="text-left decoration-dotted underline-offset-4 hover:underline"
        >
          {children}
        </button>
      </SheetTrigger>
      <SheetContent className="p-0">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {items.length} evidence item{items.length === 1 ? "" : "s"}. Only a confirmed document may
            be stated as fact; everything else stays attributed.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-7rem)]">
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="space-y-1.5 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.kind === "document" ? (
                    <FileText className="text-muted-foreground size-3.5" aria-hidden />
                  ) : item.kind === "external_link" ? (
                    <Link2 className="text-muted-foreground size-3.5" aria-hidden />
                  ) : null}
                  {item.claimStatus ? (
                    <Badge variant={CLAIM_VARIANT[item.claimStatus]}>
                      {CLAIM_STATUS_LABELS[item.claimStatus]}
                    </Badge>
                  ) : null}
                  {item.sourceAuthority ? (
                    <Badge variant="outline">{item.sourceAuthority.replace(/_/g, " ")}</Badge>
                  ) : null}
                  {item.rightsStatus === "restricted" ? (
                    <Badge variant="muted" className="gap-1">
                      <Lock className="size-3" aria-hidden /> licensed
                    </Badge>
                  ) : null}
                </div>

                <p className="text-sm">{item.summary}</p>

                {item.documentTitle ? (
                  <p className="text-muted-foreground text-xs">
                    {item.documentTitle}
                    {item.pageRef ? ` · ${item.pageRef}` : ""}
                  </p>
                ) : null}

                {item.computation ? (
                  <p className="text-muted-foreground text-xs">
                    Computed value from <code>{item.computation.table}</code>
                    {item.computation.formulaVersion ? ` · formula ${item.computation.formulaVersion}` : ""}
                  </p>
                ) : null}

                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  {item.asOf ? <span>{formatTimestamp(item.asOf, { withTime: true })}</span> : null}
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary hover:underline"
                    >
                      open source
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
            {items.length === 0 ? (
              <li className="text-muted-foreground p-4 text-sm">
                No evidence records are attached to this claim. It should not be presented as a fact.
              </li>
            ) : null}
          </ul>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
