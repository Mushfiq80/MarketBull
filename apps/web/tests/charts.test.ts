import { describe, expect, it } from "vitest";

import {
  CHART_SERIES,
  MAX_ALL_PAIRS_SERIES,
  divergingBucket,
  seriesColor,
  sequentialBucket,
} from "@/lib/charts/theme";

describe("chart palette rules", () => {
  it("assigns categorical hues in fixed order", () => {
    expect(seriesColor(0)).toBe(CHART_SERIES[0]);
    expect(seriesColor(7)).toBe(CHART_SERIES[7]);
  });

  it("throws rather than cycling past the last slot", () => {
    // Cycling is the failure mode this guard exists to prevent: two series would
    // silently share a colour.
    expect(() => seriesColor(CHART_SERIES.length)).toThrow(/must not be cycled/i);
  });

  it("caps all-pairs forms at three series", () => {
    expect(MAX_ALL_PAIRS_SERIES).toBe(3);
  });

  it("puts a neutral midpoint on the diverging ramp", () => {
    expect(divergingBucket(0)).toBe("var(--div-mid)");
    expect(divergingBucket(0.02)).toBe("var(--div-mid)");
    expect(divergingBucket(-1)).not.toBe(divergingBucket(1));
  });

  it("clamps sequential buckets to the ramp", () => {
    expect(sequentialBucket(-5)).toBe("var(--seq-100)");
    expect(sequentialBucket(5)).toBe("var(--seq-700)");
    expect(sequentialBucket(Number.NaN)).toBe("var(--seq-100)");
  });
});
