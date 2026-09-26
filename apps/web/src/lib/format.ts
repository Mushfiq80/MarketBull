import { publicEnv } from "./public-env";
import type { StatefulValue, ValueState } from "./domain/states";

/* ===========================================================================
   The single place market-sensitive values become text.
   Nothing in the UI may hand-render a value — the four display states must stay
   distinct, and that only holds if there is one implementation.

       missing  ≠  stale  ≠  zero  ≠  confirmed negative
   =========================================================================== */

export type FormattedValue = {
  text: string;
  state: ValueState;
  /** Tone drives ink colour, not meaning. Meaning is carried by glyph + sign. */
  tone: "primary" | "secondary" | "muted" | "gain" | "loss";
  /** Prefix glyph. Always paired with a sign so colour is never load-bearing. */
  glyph?: "up" | "down" | "clock" | "lock" | "review";
  title?: string;
  isNegative: boolean;
  isZero: boolean;
};

const EM_DASH = "—";

function toNumber(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function group(n: number, minFrac: number, maxFrac: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  }).format(n);
}

function ageText(minutes: number | undefined): string {
  if (minutes === undefined) return "";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (60 * 24))}d`;
}

/**
 * Format a stateful value for display.
 *
 * Deliberately verbose in its return shape: components need the state and tone
 * separately so they can add the mandatory non-colour cue.
 */
export function formatValue(
  v: StatefulValue | null | undefined,
  opts: {
    kind?: "price" | "percent" | "ratio" | "integer" | "money" | "score" | "multiple";
    decimals?: number;
    signed?: boolean;
  } = {},
): FormattedValue {
  const kind = opts.kind ?? "ratio";

  // --- absent -------------------------------------------------------------
  if (!v || v.state === "unavailable" || v.value === null) {
    return {
      text: EM_DASH,
      state: "unavailable",
      tone: "muted",
      title: v?.reason ?? "Not available. This is not zero — the value is unknown.",
      isNegative: false,
      isZero: false,
    };
  }

  if (v.state === "restricted") {
    return {
      text: "licensed",
      state: "restricted",
      tone: "muted",
      glyph: "lock",
      title: v.reason ?? "Licensed source — not displayable in this build.",
      isNegative: false,
      isZero: false,
    };
  }

  if (v.state === "under_review") {
    return {
      text: "review",
      state: "under_review",
      tone: "muted",
      glyph: "review",
      title: v.reason ?? "Under review — value withheld until verified.",
      isNegative: false,
      isZero: false,
    };
  }

  const n = toNumber(v.value);
  if (n === null) {
    return {
      text: EM_DASH,
      state: "unavailable",
      tone: "muted",
      title: "Value could not be parsed.",
      isNegative: false,
      isZero: false,
    };
  }

  const decimals =
    opts.decimals ??
    (kind === "integer"
      ? 0
      : kind === "score"
        ? 1
        : kind === "percent"
          ? 2
          : kind === "money"
            ? 0
            : 2);

  let body: string;
  switch (kind) {
    case "percent":
      body = `${group(n, decimals, decimals)}%`;
      break;
    case "multiple":
      body = `${group(n, decimals, decimals)}×`;
      break;
    case "money":
      body = formatCompactMoney(n);
      break;
    case "integer":
      body = group(n, 0, 0);
      break;
    default:
      body = group(n, decimals, decimals);
  }

  const isZero = n === 0;
  const isNegative = n < 0;

  // Signed values carry a glyph AND a sign — colour is reinforcement only.
  if (opts.signed) {
    const sign = isNegative ? "−" : n > 0 ? "+" : "";
    const abs = body.replace(/^-/, "");
    body = `${sign}${abs}`;
  }

  // --- stale but real ------------------------------------------------------
  if (v.state === "stale") {
    const age = ageText(v.ageMinutes);
    return {
      text: age ? `${body} ${age}` : body,
      state: "stale",
      tone: "secondary",
      glyph: "clock",
      title: v.reason ?? `Stale value${age ? ` — last updated ${age} ago` : ""}. Real, but past its freshness budget.`,
      isNegative,
      isZero,
    };
  }

  // --- available ----------------------------------------------------------
  return {
    text: body,
    state: "available",
    tone: opts.signed ? (isNegative ? "loss" : n > 0 ? "gain" : "muted") : "primary",
    glyph: opts.signed ? (isNegative ? "down" : n > 0 ? "up" : undefined) : undefined,
    title: v.unit ? `${body} ${v.unit}` : undefined,
    isNegative,
    isZero,
  };
}

/** Compact BDT for turnover/market cap. Crore/lakh are the local conventions. */
export function formatCompactMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e7) return `${sign}${group(abs / 1e7, 2, 2)} cr`; // 1 crore = 10,000,000
  if (abs >= 1e5) return `${sign}${group(abs / 1e5, 2, 2)} lakh`;
  return `${sign}${group(abs, 0, 0)}`;
}

/** Display timestamps in Dhaka time; storage is always UTC. */
export function formatTimestamp(
  iso: string | Date | null | undefined,
  opts: { withTime?: boolean; withSeconds?: boolean } = {},
): string {
  if (!iso) return EM_DASH;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: publicEnv.displayTimezone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    ...(opts.withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    ...(opts.withSeconds ? { second: "2-digit" } : {}),
  }).format(d);
}

export function formatSessionDate(d: string | null | undefined): string {
  if (!d) return EM_DASH;
  const parsed = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return d;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(parsed);
}

/** "3 minutes ago" style age, for freshness badges. */
export function formatAge(iso: string | Date | null | undefined): string {
  if (!iso) return "never";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const minutes = (Date.now() - d.getTime()) / 60000;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  const days = Math.round(minutes / (60 * 24));
  return `${days}d ago`;
}

/** Convenience wrapper so callers can pass a bare DB value. */
export function stateful(
  value: string | number | null | undefined,
  state: ValueState = "available",
  extra: Partial<StatefulValue> = {},
): StatefulValue {
  if (value === null || value === undefined) {
    return {
      value: null,
      state: "unavailable",
      // The clarification matters: a reader must never read an em dash as a zero.
      reason: extra.reason ?? "Not available — the value is unknown. This is not zero.",
    };
  }
  return { value: String(value), state, ...extra };
}
