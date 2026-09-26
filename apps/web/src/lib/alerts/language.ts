/**
 * Alert language.
 *
 * Alerts are the most likely thing a user reads without context, so the wording
 * is generated from templates rather than composed freely. No code path can
 * produce an accusation or a prediction.
 */

export const ALERT_TEMPLATES = {
  price_threshold: (t: string, price: string, threshold: string, direction: "above" | "below") =>
    `${t} closed at ${price}, ${direction} your ${threshold} threshold.`,

  volume_spike: (t: string, multiple: string, baseline: string, hasDisclosure: boolean) =>
    `${t} turnover was ${multiple}× its ${baseline}. ` +
    (hasDisclosure
      ? "A disclosure was published in the same window."
      : "No corresponding disclosure was found in the same window."),

  new_filing: (t: string, docType: string, period: string) =>
    `${t} published a ${docType}${period ? ` for ${period}` : ""}.`,

  corporate_action: (t: string, actionType: string, exDate: string) =>
    `${t} announced a ${actionType}. Ex-date ${exDate}.`,

  governance_event: (t: string, status: string, authority: string, subject: string) =>
    `${authority} record for ${t} — status: ${status}. Subject: ${subject}.` +
    (status === "final_finding" ? "" : " This is not a final finding."),

  data_quality: (sourceId: string, kind: string, summary: string) =>
    `Data quality issue on ${sourceId} (${kind}): ${summary}`,

  thesis_change: (t: string, from: string, to: string, horizon: string) =>
    `${t} ${horizon}-horizon score moved from ${from} to ${to}.`,

  gate_change: (t: string, from: string, to: string, reason: string) =>
    `${t} risk gate changed from ${from} to ${to}. ${reason}`,

  regime_transition: (from: string, to: string, met: number, total: number) =>
    `Market regime classification changed from ${from} to ${to}. ` +
    `${met} of ${total} confirming conditions met. This is a classification, not a forecast.`,

  shariah_status_change: (t: string, from: string, to: string, methodology: string) =>
    `${t} screen status under ${methodology} changed from ${from} to ${to}. ` +
    "This is a data screen, not a certification.",

  score_move: (t: string, delta: string, horizon: string) =>
    `${t} ${horizon}-horizon score moved ${delta} points since the previous snapshot.`,
} as const;

/** Words an alert may never contain. Enforced in tests, not just in review. */
export const BANNED_IN_ALERTS = [
  "manipulation",
  "manipulated",
  "insider",
  "pump",
  "scam",
  "fraud",
  "guaranteed",
  "will rise",
  "will fall",
  "buy now",
  "sell now",
  "opportunity of",
];

export function validateAlertText(text: string): { ok: boolean; offending: string[] } {
  const lower = text.toLowerCase();
  const offending = BANNED_IN_ALERTS.filter((w) => lower.includes(w));
  return { ok: offending.length === 0, offending };
}
