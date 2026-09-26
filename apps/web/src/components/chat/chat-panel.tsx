"use client";

import * as React from "react";
import { Loader2, Send, ShieldCheck, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

type Turn = {
  role: "user" | "assistant";
  content: string;
  meta?: {
    agentRole: string;
    toolCalls: { name: string; ok: boolean }[];
    evidenceIds: string[];
    abstained: boolean;
    blocked: boolean;
  };
};

const SUGGESTIONS = [
  "What is the market regime right now, and how confident is it?",
  "Show me the top medium-term ranked names and why they rank there",
  "What regulatory records exist for GP?",
  "What events did BRACBANK publish this quarter?",
];

export function ChatPanel() {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", content: question }]);
    setLoading(true);

    try {
      const res = await fetch("/api/v1/research/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history: turns.slice(-8).map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setTurns((t) => [
          ...t,
          { role: "assistant", content: json?.error?.message ?? "Request failed." },
        ]);
      } else {
        const d = json.data;
        setTurns((t) => [
          ...t,
          {
            role: "assistant",
            content: d.answer,
            meta: {
              agentRole: d.role,
              toolCalls: d.toolCalls ?? [],
              evidenceIds: d.evidenceIds ?? [],
              abstained: Boolean(d.abstained),
              blocked: Boolean(d.guardrail?.blocked),
            },
          },
        ]);
      }
    } catch (err) {
      setTurns((t) => [...t, { role: "assistant", content: String(err) }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="flex h-[calc(100vh-14rem)] flex-col">
      <ScrollArea className="flex-1" >
        <div ref={scrollRef} className="space-y-4 p-4">
          {turns.length === 0 ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Ask about the market, a company, its filings or its governance record. Answers come
                from stored data with citations. When the evidence is not there, it says so instead of
                guessing.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} variant="outline" size="sm" className="text-xs" onClick={() => ask(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {turns.map((turn, i) => (
            <div key={i} className={turn.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  turn.role === "user"
                    ? "bg-secondary max-w-[80%] rounded-lg px-3 py-2 text-sm"
                    : "max-w-[90%] space-y-2"
                }
              >
                <p className="text-sm whitespace-pre-wrap">{renderCitations(turn.content)}</p>

                {turn.meta ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{turn.meta.agentRole.replace(/_/g, " ")}</Badge>
                    {turn.meta.blocked ? (
                      <Badge variant="critical" className="gap-1">
                        <TriangleAlert className="size-3" aria-hidden /> blocked by guardrails
                      </Badge>
                    ) : turn.meta.abstained ? (
                      <Badge variant="warning">abstained</Badge>
                    ) : (
                      <Badge variant="good" className="gap-1">
                        <ShieldCheck className="size-3" aria-hidden /> grounded
                      </Badge>
                    )}
                    {turn.meta.toolCalls.map((c, ci) => (
                      <Badge key={ci} variant={c.ok ? "muted" : "warning"}>
                        {c.name}
                      </Badge>
                    ))}
                    {turn.meta.evidenceIds.length ? (
                      <span className="text-muted-foreground text-[11px]">
                        {turn.meta.evidenceIds.length} evidence record
                        {turn.meta.evidenceIds.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {loading ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" /> retrieving evidence…
            </p>
          ) : null}
        </div>
      </ScrollArea>

      <CardContent className="border-t p-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the market, a company, or a filing…"
            disabled={loading}
          />
          <Button type="submit" disabled={loading || !input.trim()}>
            <Send />
          </Button>
        </form>
        <p className="text-muted-foreground mt-2 text-[11px]">
          Research and decision support. Not investment advice. Figures come from stored calculations,
          never from the model.
        </p>
      </CardContent>
    </Card>
  );
}

/** Render [ev:<id>] citations as clickable evidence links. */
function renderCitations(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\[ev:([^\]]+)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <a
        key={key++}
        href={`/api/v1/research/evidence/${match[1]}`}
        target="_blank"
        rel="noreferrer noopener"
        className="text-primary align-super text-[10px] hover:underline"
        title="Open the evidence record"
      >
        [source]
      </a>,
    );
    last = regex.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
