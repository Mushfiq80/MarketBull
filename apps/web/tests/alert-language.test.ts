import { describe, expect, it } from "vitest";

import { ALERT_TEMPLATES, validateAlertText } from "@/lib/alerts/language";

/**
 * Alerts are the most likely thing read without context, so no code path may
 * produce an accusation or a prediction.
 */
describe("alert language", () => {
  it("rejects accusatory wording", () => {
    for (const text of [
      "SAMPBANK shows clear manipulation today",
      "Possible insider trading detected",
      "This is a guaranteed opportunity",
      "SAMPTEX will rise tomorrow",
    ]) {
      expect(validateAlertText(text).ok).toBe(false);
    }
  });

  it("accepts the volume-spike template, which states the observation only", () => {
    const withDisclosure = ALERT_TEMPLATES.volume_spike("SAMPBANK", "14.2", "60-session median", true);
    const without = ALERT_TEMPLATES.volume_spike("SAMPBANK", "14.2", "60-session median", false);

    expect(validateAlertText(withDisclosure).ok).toBe(true);
    expect(validateAlertText(without).ok).toBe(true);
    expect(without).toMatch(/No corresponding disclosure/);
    expect(without.toLowerCase()).not.toContain("manipul");
  });

  it("qualifies a non-final governance record", () => {
    const text = ALERT_TEMPLATES.governance_event("SAMPTHIN", "allegation", "BSEC", "late filing");
    expect(text).toMatch(/not a final finding/i);
    expect(validateAlertText(text).ok).toBe(true);
  });

  it("states that a regime change is a classification, not a forecast", () => {
    const text = ALERT_TEMPLATES.regime_transition("bull", "late_bull_distribution", 2, 5);
    expect(text).toMatch(/not a forecast/i);
  });

  it("never calls a screen result a certification", () => {
    const text = ALERT_TEMPLATES.shariah_status_change("SAMPPHRM", "pass", "undetermined", "aaoifi_style");
    expect(text).toMatch(/not a certification/i);
  });
});
