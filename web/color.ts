// Stable color per visitor: hash the visitorId to a hue, derive an HSL palette.
// Same visitor -> same color for its lifetime (no server state, no collision
// coordination). Saturation/lightness are kept moderate to stay legible against
// the dark, fire-tinted scene.

export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hueForVisitor(visitorId: string): number {
  return fnv1a(visitorId) % 360;
}

export function hsla(h: number, s: number, l: number, a: number): string {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}
