// Day/night theme driven by the day fraction (0..1, derived from server time).
// Subtle by design: night stays near-black so the fire keeps dominating;
// dawn/dusk warm the horizon, midday cools it to a deep navy.

export type RGB = [number, number, number];

export type Theme = {
  frac: number;
  skyTop: RGB; // top of the canvas gradient
  skyHorizon: RGB; // near the waterline / fire
  wave: RGB; // wave tint
  marker: RGB; // day-bar marker + fill accent
  star: number; // starfield opacity (always >0: faint by day, full at night)
  phase: string;
};

type Anchor = {
  at: number;
  skyTop: RGB;
  skyHorizon: RGB;
  wave: RGB;
  marker: RGB;
  star: number;
  phase: string;
};

// Anchor moments across the day. `at` is the fraction (hour / 24).
const ANCHORS: Anchor[] = [
  { at: 0.0, skyTop: [4, 5, 12], skyHorizon: [6, 6, 8], wave: [90, 120, 165], marker: [150, 170, 210], star: 1.0, phase: "night" },
  { at: 0.22, skyTop: [8, 10, 20], skyHorizon: [20, 14, 24], wave: [110, 115, 160], marker: [155, 150, 200], star: 0.75, phase: "dawn" },
  { at: 0.28, skyTop: [16, 20, 40], skyHorizon: [60, 28, 16], wave: [170, 120, 120], marker: [255, 150, 90], star: 0.35, phase: "sunrise" },
  { at: 0.36, skyTop: [18, 26, 46], skyHorizon: [22, 20, 22], wave: [120, 150, 185], marker: [180, 200, 230], star: 0.14, phase: "day" },
  { at: 0.5, skyTop: [26, 38, 62], skyHorizon: [18, 22, 28], wave: [120, 155, 195], marker: [205, 222, 240], star: 0.09, phase: "noon" },
  { at: 0.68, skyTop: [22, 26, 44], skyHorizon: [26, 20, 16], wave: [130, 150, 180], marker: [200, 205, 225], star: 0.14, phase: "day" },
  { at: 0.76, skyTop: [26, 16, 34], skyHorizon: [64, 26, 12], wave: [185, 110, 105], marker: [255, 140, 70], star: 0.35, phase: "sunset" },
  { at: 0.83, skyTop: [12, 10, 22], skyHorizon: [30, 14, 16], wave: [120, 100, 130], marker: [205, 130, 150], star: 0.6, phase: "dusk" },
  { at: 0.92, skyTop: [6, 7, 13], skyHorizon: [10, 7, 8], wave: [95, 120, 165], marker: [160, 175, 210], star: 0.9, phase: "night" },
  { at: 1.0, skyTop: [4, 5, 12], skyHorizon: [6, 6, 8], wave: [90, 120, 165], marker: [150, 170, 210], star: 1.0, phase: "night" },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
}

export function themeAt(frac: number): Theme {
  const f = ((frac % 1) + 1) % 1;
  let lo = ANCHORS[0]!;
  let hi = ANCHORS[ANCHORS.length - 1]!;
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    if (f >= ANCHORS[i]!.at && f <= ANCHORS[i + 1]!.at) {
      lo = ANCHORS[i]!;
      hi = ANCHORS[i + 1]!;
      break;
    }
  }
  const span = hi.at - lo.at || 1;
  const t = (f - lo.at) / span;
  return {
    frac: f,
    skyTop: lerpRGB(lo.skyTop, hi.skyTop, t),
    skyHorizon: lerpRGB(lo.skyHorizon, hi.skyHorizon, t),
    wave: lerpRGB(lo.wave, hi.wave, t),
    marker: lerpRGB(lo.marker, hi.marker, t),
    star: lerp(lo.star, hi.star, t),
    phase: t < 0.5 ? lo.phase : hi.phase,
  };
}

export function rgb(c: RGB, a = 1): string {
  return a >= 1 ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}
