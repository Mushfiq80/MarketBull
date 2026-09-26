/**
 * Agent roles.
 *
 * These are prompt scopes over the same tool layer, not separate services. Each
 * role restricts which tools it may call, so a governance question cannot
 * quietly turn into a valuation claim.
 */

export type AgentRole =
  | "orchestrator"
  | "financial_analyst"
  | "event_analyst"
  | "governance_analyst"
  | "report_composer";

export const AGENTS: Record<AgentRole, { label: string; purpose: string; tools: string[] }> = {
  orchestrator: {
    label: "Market research orchestrator",
    purpose: "Routes a question to the right tools and assembles the answer.",
    tools: ["resolve_issuer", "get_market_overview", "get_rankings", "search_documents"],
  },
  financial_analyst: {
    label: "Financial analyst",
    purpose:
      "Requests stored financial metrics and explains what they mean. Does not calculate — the deterministic engine owns arithmetic.",
    tools: ["resolve_issuer", "get_financials", "get_scores"],
  },
  event_analyst: {
    label: "Event analyst",
    purpose: "Builds a sourced timeline and states claim status for every item.",
    tools: ["resolve_issuer", "get_events", "search_documents"],
  },
  governance_analyst: {
    label: "Governance analyst",
    purpose:
      "Retrieves official filings and classifies documented risk, keeping allegation and finding distinct.",
    tools: ["resolve_issuer", "get_governance", "search_documents"],
  },
  report_composer: {
    label: "FOX report composer",
    purpose:
      "Combines validated pillar outputs, counter-evidence, scenarios and caveats into prose. Adds no numbers of its own.",
    tools: ["get_scores", "get_financials", "get_events", "get_governance", "get_shariah_screen"],
  },
};

export function toolsFor(role: AgentRole): string[] {
  return AGENTS[role].tools;
}

/** Route a question to the narrowest role that can answer it. */
export function routeQuestion(question: string): AgentRole {
  const q = question.toLowerCase();
  if (/\b(director|board|enforcement|bsec|penalt|regulat|governance|audit)\b/.test(q)) {
    return "governance_analyst";
  }
  if (/\b(news|event|announce|dividend|agm|disclosure|filing|happened)\b/.test(q)) {
    return "event_analyst";
  }
  if (/\b(revenue|profit|margin|eps|balance sheet|cash flow|ratio|valuation|p\/e|roe)\b/.test(q)) {
    return "financial_analyst";
  }
  return "orchestrator";
}
