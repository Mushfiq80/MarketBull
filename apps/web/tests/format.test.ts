import { describe, expect, it } from "vitest";

import { formatValue, stateful } from "@/lib/format";

/**
 * The four display states must never collapse into one another. This is the test
 * that stops a future refactor from turning a missing value into a zero.
 */
describe("formatValue — the four states stay distinct", () => {
  it("renders a missing value as an em dash, never zero", () => {
    const f = formatValue(stateful(null));
    expect(f.text).toBe("—");
    expect(f.state).toBe("unavailable");
    expect(f.isZero).toBe(false);
    expect(f.title).toMatch(/not zero/i);
  });

  it("renders a confirmed zero as 0.00, never a dash", () => {
    const f = formatValue(stateful(0), { kind: "price" });
    expect(f.text).toBe("0.00");
    expect(f.state).toBe("available");
    expect(f.isZero).toBe(true);
  });

  it("distinguishes stale from available", () => {
    const stale = formatValue({ value: "42.18", state: "stale", ageMinutes: 4320 });
    expect(stale.state).toBe("stale");
    expect(stale.glyph).toBe("clock");
    expect(stale.text).toContain("3d");

    const fresh = formatValue({ value: "42.18", state: "available" });
    expect(fresh.state).toBe("available");
    expect(fresh.glyph).toBeUndefined();
  });

  it("renders a confirmed negative signed, with a glyph", () => {
    const f = formatValue(stateful(-4.2), { kind: "percent", signed: true });
    expect(f.isNegative).toBe(true);
    expect(f.glyph).toBe("down");
    expect(f.tone).toBe("loss");
    // Colour is never the only cue — the sign is in the text.
    expect(f.text).toContain("−");
  });

  it("pairs every colour cue with a glyph", () => {
    const up = formatValue(stateful(1.5), { kind: "percent", signed: true });
    expect(up.tone).toBe("gain");
    expect(up.glyph).toBe("up");
    expect(up.text.startsWith("+")).toBe(true);
  });

  it("marks restricted values without leaking them", () => {
    const f = formatValue({ value: "123", state: "restricted", reason: "Licensed feed." });
    expect(f.text).toBe("licensed");
    expect(f.glyph).toBe("lock");
    expect(f.text).not.toContain("123");
  });
});
