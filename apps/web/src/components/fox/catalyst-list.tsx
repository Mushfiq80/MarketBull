import { CalendarClock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSessionDate } from "@/lib/format";

export function CatalystList({ report }: { report: any | null }) {
  const catalysts = (report?.catalysts ?? []) as {
    horizon: "near" | "medium" | "long";
    description: string;
    eventDate: string | null;
    sourceStatus: string;
  }[];

  if (!catalysts.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarClock className="text-muted-foreground size-4" aria-hidden />
          Catalysts
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {catalysts.map((c, i) => (
            <li key={i}>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline">{c.horizon}</Badge>
                <Badge variant={c.sourceStatus === "confirmed_document" ? "good" : "warning"}>
                  {c.sourceStatus.replace(/_/g, " ")}
                </Badge>
              </div>
              <p className="mt-1 text-sm">{c.description}</p>
              <p className="text-muted-foreground text-xs">
                {c.eventDate ? formatSessionDate(c.eventDate) : "Date not confirmed"}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-3 border-t pt-2 text-xs">
          A catalyst is an event that may cause investors to reassess. It is not a prediction that
          the price will move, or in which direction.
        </p>
      </CardContent>
    </Card>
  );
}
