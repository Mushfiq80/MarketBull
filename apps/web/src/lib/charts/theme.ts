/**
 * Chart theming. Both libraries read from here so a token change lands in one
 * place. Colours are the validated palette — see babull-docs/05-design-system.md.
 * Do not edit a hex without re-running `npm run viz:validate`.
 */

/** Fixed categorical slot order. NEVER cycled — a 9th series folds to "Other". */
export const CHART_SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;

export const MAX_CATEGORICAL_SERIES = CHART_SERIES.length;

/**
 * Scatter / bubble / small-multiple charts compare every pair, not just
 * adjacent ones. Only the first three slots clear all-pairs CVD validation,
 * so those forms cap at three series — past that, facet or fold to "Other".
 */
export const MAX_ALL_PAIRS_SERIES = 3;

export function seriesColor(index: number): string {
  if (index >= CHART_SERIES.length) {
    throw new Error(
      `Categorical palette has ${CHART_SERIES.length} slots and must not be cycled. ` +
        `Fold series ${index + 1}+ into "Other", or use small multiples.`,
    );
  }
  return CHART_SERIES[index]!;
}

/** Sequential ramp for magnitude (heat strips, choropleths). One hue, light→dark. */
export const SEQUENTIAL = [
  "var(--seq-100)",
  "var(--seq-200)",
  "var(--seq-300)",
  "var(--seq-400)",
  "var(--seq-500)",
  "var(--seq-600)",
  "var(--seq-700)",
] as const;

/** Diverging ramp for polarity. Two hues + a NEUTRAL GRAY midpoint. */
export const DIVERGING = [
  "var(--div-neg-2)",
  "var(--div-neg-1)",
  "var(--div-mid)",
  "var(--div-pos-1)",
  "var(--div-pos-2)",
] as const;

/** Reserved market semantics. NEVER used as a series colour. */
export const MARKET = {
  gain: "var(--gain)",
  loss: "var(--loss)",
  flat: "var(--flat)",
  limit: "var(--limit)",
} as const;

export const CHROME = {
  surface: "var(--card)",
  grid: "var(--grid)",
  axis: "var(--axis)",
  textPrimary: "var(--foreground)",
  textSecondary: "var(--ink-secondary)",
  textMuted: "var(--muted-foreground)",
} as const;

/** Mark specs — thin marks, generous spacers. */
export const MARKS = {
  lineWidth: 2,
  markerSize: 8,
  barRadius: 4,
  /** 2px surface gap between adjacent and stacked fills. */
  barGapPx: 2,
  gridDash: "2 4",
} as const;

/**
 * Pick a diverging bucket for a signed magnitude in [-1, 1].
 * Used by the sector heat strip and factor z-score cells.
 */
export function divergingBucket(normalized: number): string {
  if (!Number.isFinite(normalized)) return "var(--div-mid)";
  if (normalized <= -0.5) return DIVERGING[0];
  if (normalized < -0.05) return DIVERGING[1];
  if (normalized <= 0.05) return DIVERGING[2];
  if (normalized < 0.5) return DIVERGING[3];
  return DIVERGING[4];
}

/** Pick a sequential bucket for a magnitude in [0, 1]. */
export function sequentialBucket(normalized: number): string {
  if (!Number.isFinite(normalized)) return "var(--seq-100)";
  const clamped = Math.min(1, Math.max(0, normalized));
  const idx = Math.min(SEQUENTIAL.length - 1, Math.floor(clamped * SEQUENTIAL.length));
  return SEQUENTIAL[idx]!;
}

/**
 * Resolve a CSS custom property to a concrete hex. lightweight-charts takes a
 * JS options object and cannot read CSS variables, so the price chart resolves
 * tokens at mount and on theme change.
 */
export function resolveCssVar(name: string, el: HTMLElement = document.documentElement): string {
  const raw = name.startsWith("var(") ? name.slice(4, -1).trim() : name;
  const value = getComputedStyle(el).getPropertyValue(raw).trim();
  return value || "#888888";
}

/** Options object for lightweight-charts, built from the live CSS tokens. */
export function lightweightChartsTheme(el?: HTMLElement) {
  const root = el ?? document.documentElement;
  return {
    layout: {
      background: { color: "transparent" },
      textColor: resolveCssVar("--muted-foreground", root),
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      fontSize: 11,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: resolveCssVar("--grid", root) },
      horzLines: { color: resolveCssVar("--grid", root) },
    },
    rightPriceScale: { borderColor: resolveCssVar("--axis", root) },
    timeScale: { borderColor: resolveCssVar("--axis", root), timeVisible: false },
    crosshair: {
      mode: 1 as const, // magnet
      vertLine: { color: resolveCssVar("--axis", root), labelBackgroundColor: resolveCssVar("--popover", root) },
      horzLine: { color: resolveCssVar("--axis", root), labelBackgroundColor: resolveCssVar("--popover", root) },
    },
  };
}

export function candlestickColors(el?: HTMLElement) {
  const root = el ?? document.documentElement;
  const up = resolveCssVar("--gain", root);
  const down = resolveCssVar("--loss", root);
  return {
    upColor: up,
    downColor: down,
    borderUpColor: up,
    borderDownColor: down,
    wickUpColor: up,
    wickDownColor: down,
  };
}
