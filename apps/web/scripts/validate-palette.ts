/**
 * Validate the chart palette.
 *
 * Colourblind separation is computable, so it is computed — never eyeballed.
 * Run: npm run viz:validate
 *
 * Checks, per mode:
 *   1. lightness band       — all slots sit in the mode's usable band
 *   2. chroma floor         — no slot is so desaturated it reads as grey
 *   3. CVD separation       — adjacent pairs stay distinguishable under protan/deutan/tritan
 *   4. normal-vision floor  — adjacent pairs are distinguishable to full-colour readers
 *   5. contrast vs surface  — every slot clears 3:1, or requires label/table relief
 *
 * These values must stay in sync with apps/web/src/app/globals.css.
 */

type Mode = "light" | "dark";
type Cvd = "protan" | "deutan" | "tritan";

const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const SURFACE: Record<Mode, string> = { light: "#fcfcfb", dark: "#15161a" };
const BAND: Record<Mode, [number, number]> = { light: [0.43, 0.77], dark: [0.48, 0.67] };

const CHROMA_FLOOR = 0.1;
const CVD_TARGET = 8;
const CVD_FLOOR = 6;
const NORMAL_FLOOR = 15;
const CONTRAST_MIN = 3;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function chroma(hex: string): number {
  const [, a, b] = toOklab(hex);
  return Math.hypot(a, b);
}

function oklabL(hex: string): number {
  return toOklab(hex)[0];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toOklab(a);
  const [l2, a2, b2] = toOklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100;
}

/** Brettel-style CVD simulation — sufficient for a separation gate. */
function simulate(hex: string, kind: Cvd): string {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear) as [number, number, number];
  const M: Record<Cvd, number[][]> = {
    protan: [
      [0.1121, 0.8853, -0.0005],
      [0.1127, 0.8897, -0.0001],
      [0.0045, 0.0, 1.0],
    ],
    deutan: [
      [0.292, 0.7054, -0.0003],
      [0.2934, 0.7089, 0.0001],
      [-0.0209, 0.0272, 1.0],
    ],
    tritan: [
      [1.0, 0.1502, -0.1519],
      [0.0, 0.8671, 0.1327],
      [0.0, 0.2966, 0.7034],
    ],
  };
  const rows = M[kind];
  const out = rows.map((row) => row[0]! * r + row[1]! * g + row[2]! * b);
  const toHex = (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${out.map(toHex).join("")}`;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function report(name: string, pass: boolean, detail: string, offenders: string[] = []): void {
  const tag = pass ? "PASS" : "FAIL";
  console.log(
    `  [${tag}] ${name.padEnd(22)} ${detail}${offenders.length ? ` -> ${offenders.join(", ")}` : ""}`,
  );
}

function validate(mode: Mode): boolean {
  const palette = mode === "light" ? LIGHT : DARK;
  const surface = SURFACE[mode];
  const [lo, hi] = BAND[mode];
  let failed = false;

  console.log(`\n=== ${mode.toUpperCase()} on ${surface} - ${palette.length} slots ===`);

  const outOfBand = palette.filter((c) => oklabL(c) < lo || oklabL(c) > hi);
  report("Lightness band", outOfBand.length === 0, `all inside L ${lo}-${hi}`, outOfBand);
  failed = failed || outOfBand.length > 0;

  const grey = palette.filter((c) => chroma(c) < CHROMA_FLOOR);
  report("Chroma floor", grey.length === 0, `all >= ${CHROMA_FLOOR}`, grey);
  failed = failed || grey.length > 0;

  let worstCvd = { pair: "", dE: Infinity, kind: "" as string };
  for (let i = 0; i < palette.length - 1; i++) {
    for (const kind of ["protan", "deutan", "tritan"] as Cvd[]) {
      const dE = deltaE(simulate(palette[i]!, kind), simulate(palette[i + 1]!, kind));
      if (dE < worstCvd.dE) worstCvd = { pair: `${palette[i]}/${palette[i + 1]}`, dE, kind };
    }
  }
  const cvdOk = worstCvd.dE >= CVD_FLOOR;
  report(
    "CVD separation",
    cvdOk,
    `worst adjacent ${worstCvd.pair} dE ${worstCvd.dE.toFixed(1)} (${worstCvd.kind})` +
      (worstCvd.dE < CVD_TARGET ? " - in the 6-8 band, secondary encoding REQUIRED" : ""),
  );
  failed = failed || !cvdOk;

  let worstNormal = { pair: "", dE: Infinity };
  for (let i = 0; i < palette.length - 1; i++) {
    const dE = deltaE(palette[i]!, palette[i + 1]!);
    if (dE < worstNormal.dE) worstNormal = { pair: `${palette[i]}/${palette[i + 1]}`, dE };
  }
  const normalOk = worstNormal.dE >= NORMAL_FLOOR;
  report(
    "Normal-vision floor",
    normalOk,
    `worst adjacent ${worstNormal.pair} dE ${worstNormal.dE.toFixed(1)} (>= ${NORMAL_FLOOR})`,
  );
  failed = failed || !normalOk;

  const lowContrast = palette
    .map((c) => ({ c, ratio: contrast(c, surface) }))
    .filter((x) => x.ratio < CONTRAST_MIN);
  if (lowContrast.length) {
    console.log(
      `  [WARN] ${"Contrast vs surface".padEnd(22)} below ${CONTRAST_MIN}:1 - relief required ` +
        `(visible direct labels or the table view): ` +
        lowContrast.map((x) => `${x.c} ${x.ratio.toFixed(2)}`).join(", "),
    );
  } else {
    report("Contrast vs surface", true, `all >= ${CONTRAST_MIN}:1`);
  }

  return !failed;
}

const lightOk = validate("light");
const darkOk = validate("dark");

console.log(
  "\nScatter / bubble / small multiples cap at 3 series - only the first three slots clear " +
    'all-pairs validation. Past three: facet or fold to "Other".',
);

if (!lightOk || !darkOk) {
  console.error("\nPalette validation FAILED. Fix the failing slots before shipping.");
  process.exit(1);
}
console.log("\nAll hard gates pass in both modes.");
