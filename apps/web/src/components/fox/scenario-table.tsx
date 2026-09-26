import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Bear / base / bull scenarios with their assumptions.
 *
 * Ranges, never a single target price. A single number implies a precision the
 * inputs cannot support, and a scenario range is not a probability.
 */
export function ScenarioTable({ report }: { report: any | null }) {
  const scenarios = (report?.scenarios ?? []) as {
    case: "bear" | "base" | "bull";
    assumptions: Record<string, string>;
    valuationMethod: string;
    rangeLow: string | null;
    rangeHigh: string | null;
    sensitivity: Record<string, string> | null;
  }[];

  if (!scenarios.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Scenarios</CardTitle>
        <p className="text-muted-foreground text-xs">
          Outcomes under explicit assumptions. These are ranges, not forecasts, and a range is not a
          probability — no likelihood is attached to any case.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Range</TableHead>
              <TableHead>Key assumptions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scenarios.map((s) => (
              <TableRow key={s.case}>
                <TableCell className="font-medium capitalize">{s.case}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{s.valuationMethod}</TableCell>
                <TableCell className="tnum text-right">
                  {s.rangeLow && s.rangeHigh ? `${s.rangeLow} – ${s.rangeHigh}` : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {Object.entries(s.assumptions ?? {})
                    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
                    .join(" · ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
