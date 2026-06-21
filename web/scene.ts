import { themeAt, rgb, type Theme } from "./theme";
import { fnv1a, hueForVisitor, hsla } from "./color";

type Oscillator = {
  visitorId: string;
  hue: number;
  a: number;
  b: number;
  phase: number;
  speed: number;
  ax: number;
  ay: number;
  seatHomeX: number; // anchor seat (fixed)
  seatHomeY: number;
  seatX: number; // current drifted center (lerp toward target)
  seatY: number;
  seatTargetX: number; // wander target, refreshed every few seconds
  seatTargetY: number;
  seatNextTurn: number; // when to pick a new wander target (elapsed)
  baseAlpha: number;
  driftSpeed: number;
  alpha: number;
  alphaTarget: number;
  flash: number; // gentle ember-kiss twinkle (decays to 0)
  bloom: number; // message/nudge brightness bloom (decays to 0)
  rippleT?: number; // nudge ripple progress (0..1, undefined when idle)
  t: number;
  trail: Array<{ x: number; y: number }>;
};

type ShootingStar = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
};

type Ember = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
};

const PAIRS: Array<[number, number]> = [
  [1, 2],
  [2, 3],
  [3, 4],
  [1, 3],
  [2, 1],
  [3, 2],
  [1, 1],
  [3, 5],
];

type Star = {
  fx: number; // x as fraction of width
  fy: number; // y as fraction of height (upper sky)
  r: number;
  a: number; // base alpha
  tw: number; // twinkle speed
  phase: number;
};

const TRAIL_LEN = 28;
const EMBER_COUNT = 30;
const SEAT_RADIUS = 17;
const SEAT_WANDER = 6; // max additional radius (vmin) the seat can drift to
const SEAT_TURN_MIN = 6; // seconds before a new wander target
const SEAT_TURN_MAX = 12;
const OSC_AMP_X = 6;
const OSC_AMP_Y = 10;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildOscillator(visitorId: string, seatIndex: number, elapsedNow: number): Oscillator {
  const seed = fnv1a(visitorId);
  const rng = mulberry32(seed);
  const pair = PAIRS[Math.floor(rng() * PAIRS.length) % PAIRS.length]!;
  const seatAngle = (seatIndex / 6) * Math.PI * 2 - Math.PI / 2;
  const homeX = Math.cos(seatAngle) * SEAT_RADIUS;
  const homeY = Math.sin(seatAngle) * SEAT_RADIUS * 0.65;
  return {
    visitorId,
    hue: hueForVisitor(visitorId),
    a: pair[0],
    b: pair[1],
    phase: rng() * Math.PI * 2,
    speed: 0.5 + rng() * 0.5,
    ax: 0.7 + rng() * 0.5,
    ay: 1.2 + rng() * 0.6,
    seatHomeX: homeX,
    seatHomeY: homeY,
    seatX: homeX,
    seatY: homeY,
    seatTargetX: homeX,
    seatTargetY: homeY,
    seatNextTurn: elapsedNow + SEAT_TURN_MIN + rng() * (SEAT_TURN_MAX - SEAT_TURN_MIN),
    baseAlpha: 0.5 + rng() * 0.35,
    driftSpeed: 0.04 + rng() * 0.06,
    alpha: 0,
    alphaTarget: 1,
    flash: 0,
    bloom: 0,
    t: 0,
    trail: [],
  };
}

type WaveLayer = {
  baseY: number; // fraction of height (0..1), measured from top
  amp: number; // in vmin
  freq: number; // spatial frequency (cycles across width)
  speed: number; // drift speed (vmin per frame)
  phase: number;
  alpha: number;
  filled: boolean;
};

const WAVES: WaveLayer[] = [
  { baseY: 0.74, amp: 1.0, freq: 1.3, speed: 0.04, phase: 0, alpha: 0.05, filled: false },
  { baseY: 0.80, amp: 1.4, freq: 1.0, speed: 0.06, phase: 1.2, alpha: 0.08, filled: false },
  { baseY: 0.86, amp: 1.8, freq: 0.8, speed: 0.08, phase: 2.4, alpha: 0.10, filled: false },
  { baseY: 0.93, amp: 2.4, freq: 0.6, speed: 0.10, phase: 3.6, alpha: 0.14, filled: true },
];

export class Scene {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private oscs = new Map<string, Oscillator>();
  private embers: Ember[] = [];
  private stars: Star[] = [];
  private shootingStars: ShootingStar[] = [];
  private waves: WaveLayer[] = WAVES.map((w) => ({ ...w }));
  private wind = 0;
  private typing = new Set<string>();
  private selfId = "";
  private moonImg = new Image();
  private moonReady = false;
  private starTarget = 80;
  // Faint, slow-drifting gas clouds that keep the night sky from feeling flat.
  private nebula = [
    { fx: 0.22, fy: 0.20, r: 0.46, col: "78, 96, 150", alpha: 0.06, drift: 0.0006, tw: 0.05, phase: 0 },
    { fx: 0.64, fy: 0.13, r: 0.52, col: "96, 76, 140", alpha: 0.05, drift: 0.0004, tw: 0.04, phase: 2.1 },
    { fx: 0.86, fy: 0.30, r: 0.40, col: "120, 84, 96", alpha: 0.045, drift: 0.0008, tw: 0.06, phase: 4.3 },
  ];
  private raf = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private cx = 0;
  private cy = 0;
  private vmin = 0;
  private reduced = false;
  private lastCount = 0;
  private elapsed = 0;
  private theme: Theme = themeAt(0);
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.moonImg.src = "/moon.png";
    this.moonImg.onload = () => {
      this.moonReady = true;
      if (this.reduced) this.renderStatic();
    };
    this.resize();
    window.addEventListener("resize", this.resize, { passive: true });
  }

  private resize = () => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.vmin = Math.min(this.w, this.h) / 100;
    this.cx = this.w * 0.5;
    this.cy = this.h * 0.58;
    for (const o of this.oscs.values()) o.trail = [];
    // Keep star density roughly constant across screen sizes (a fixed count
    // looks cramped on phones). Only rebuild when the target actually changes,
    // so the mobile keyboard's viewport resize doesn't reshuffle the sky.
    const target = Math.max(26, Math.min(110, Math.round((this.w * this.h) / 11000)));
    if (target !== this.starTarget) {
      this.starTarget = target;
      this.stars = [];
    }
  };

  add(visitorId: string, seatIndex: number): void {
    if (this.oscs.has(visitorId)) return;
    if (seatIndex > 5) return;
    this.oscs.set(visitorId, buildOscillator(visitorId, seatIndex, this.elapsed));
    if (this.reduced) this.renderStatic();
  }

  remove(visitorId: string): void {
    const o = this.oscs.get(visitorId);
    if (o) o.alphaTarget = 0;
    this.typing.delete(visitorId);
  }

  setCount(n: number): void {
    this.lastCount = n;
  }

  setTheme(t: Theme): void {
    this.theme = t;
    // Under reduced motion the loop is idle, so repaint the static frame.
    if (this.reduced) this.renderStatic();
  }

  setTyping(visitorId: string, typing: boolean): void {
    if (typing) this.typing.add(visitorId);
    else this.typing.delete(visitorId);
    if (this.reduced) this.renderStatic();
  }

  // The viewer's own visitor id — its pastille gets a subtle marker ring.
  setSelf(visitorId: string): void {
    this.selfId = visitorId;
    if (this.reduced) this.renderStatic();
  }

  // Brief brightness bloom on a pastille when its visitor sends a message, so
  // you can see who just spoke. Its own channel (bloom), separate from the
  // ember-kiss twinkle, so the two never fight.
  speak(visitorId: string): void {
    const o = this.oscs.get(visitorId);
    if (!o) return;
    o.bloom = Math.min(1.8, o.bloom + 1.0);
    if (this.reduced) this.renderStatic();
  }

  // Drop any oscillators not present in the given id set. Called on (re)init so
  // a reconnect can't leave orphaned pastilles behind (the count stays right
  // but stale dots would otherwise pile up, especially on mobile).
  retain(ids: Set<string>): void {
    for (const id of [...this.oscs.keys()]) {
      if (!ids.has(id)) {
        this.oscs.delete(id);
        this.typing.delete(id);
      }
    }
  }

  ripple(visitorId: string): void {
    const o = this.oscs.get(visitorId);
    if (!o) return;
    o.bloom = Math.max(o.bloom, 1.2);
    o.rippleT = 0;
    if (this.reduced) this.renderStatic();
  }

  private paintSky(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, rgb(this.theme.skyTop));
    g.addColorStop(0.78, rgb(this.theme.skyHorizon));
    g.addColorStop(1, rgb(this.theme.skyHorizon));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private ensureStars(): void {
    if (this.stars.length > 0) return;
    for (let i = 0; i < this.starTarget; i++) {
      this.stars.push({
        fx: Math.random(),
        fy: 0.03 + Math.random() * Math.random() * 0.58, // biased toward the top
        r: 0.3 + Math.random() * 0.9,
        a: 0.35 + Math.random() * 0.55,
        tw: 0.6 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  // Very faint colored haze drifting slowly across the upper sky. Additive and
  // low-alpha so it only registers as a subtle depth cue, strongest at night.
  private drawNebula(): void {
    const intensity = this.theme.star;
    if (intensity <= 0.04) return;
    const ctx = this.ctx;
    const t = this.elapsed;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const c of this.nebula) {
      const breathe = 0.55 + 0.45 * Math.sin(t * c.tw + c.phase);
      const x = (((c.fx + t * c.drift) % 1.25) - 0.12) * this.w;
      const y = c.fy * this.h;
      const r = c.r * this.w;
      const a = c.alpha * intensity * breathe;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${c.col}, ${a})`);
      g.addColorStop(1, `rgba(${c.col}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawStars(): void {
    const alpha = this.theme.star;
    if (alpha <= 0.01) return;
    this.ensureStars();
    const ctx = this.ctx;
    for (const s of this.stars) {
      const tw = this.reduced ? 1 : 0.7 + 0.3 * Math.sin(this.elapsed * s.tw + s.phase);
      ctx.fillStyle = `rgba(222, 226, 238, ${s.a * alpha * tw})`;
      ctx.beginPath();
      ctx.arc(s.fx * this.w + this.wind * 0.2 * this.vmin, s.fy * this.h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Rare bright streak across the upper sky. Spawned only at night, ~1 per 60s.
  private drawShootingStars(): void {
    const ctx = this.ctx;
    if (this.theme.star > 0.5 && Math.random() < 1 / 3600) {
      const startX = Math.random() * this.w * 0.6;
      const startY = Math.random() * this.h * 0.5;
      const angle = Math.PI * 0.18 + Math.random() * 0.12; // shallow diagonal
      const speed = (this.w * 0.9) / 0.8; // cross ~90% of width in 0.8s (per second)
      const maxLife = 48; // ~0.8s at 60fps
      this.shootingStars.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed / 60,
        vy: Math.sin(angle) * speed / 60,
        life: maxLife,
        maxLife,
      });
    }
    for (let i = this.shootingStars.length - 1; i >= 0; i--) {
      const s = this.shootingStars[i]!;
      s.x += s.vx;
      s.y += s.vy;
      s.life -= 1;
      if (s.life <= 0) {
        this.shootingStars.splice(i, 1);
        continue;
      }
      const p = s.life / s.maxLife;
      const tailLen = 9 * this.vmin;
      const mag = Math.hypot(s.vx, s.vy) || 1;
      const tx = s.x - (s.vx / mag) * tailLen;
      const ty = s.y - (s.vy / mag) * tailLen;
      const grad = ctx.createLinearGradient(s.x, s.y, tx, ty);
      grad.addColorStop(0, `rgba(255, 255, 255, ${0.9 * p})`);
      grad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      // Bright head dot.
      ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * p})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Trace the lit (or unlit) region of the moon as a closed path: down one limb
  // and back up the terminator. The terminator is a half-ellipse with
  // horizontal radius R·cos(phase), signed so it bulges the right way for
  // crescent vs gibbous. Lit limb is on the right when waxing, left when waning.
  private tracePhase(mx: number, my: number, R: number, phase: number, lit: boolean): void {
    const ctx = this.ctx;
    const waxing = phase < 0.5;
    const k = Math.cos(phase * Math.PI * 2); // +1 new … -1 full
    const litSign = waxing ? 1 : -1;
    const sign = lit ? litSign : -litSign;
    const STEPS = 36;
    ctx.beginPath();
    for (let i = 0; i <= STEPS; i++) {
      const yy = -R + (2 * R * i) / STEPS;
      const half = Math.sqrt(Math.max(0, R * R - yy * yy));
      if (i === 0) ctx.moveTo(mx + sign * half, my + yy);
      else ctx.lineTo(mx + sign * half, my + yy);
    }
    for (let i = STEPS; i >= 0; i--) {
      const yy = -R + (2 * R * i) / STEPS;
      const half = Math.sqrt(Math.max(0, R * R - yy * yy));
      ctx.lineTo(mx + (waxing ? k : -k) * half, my + yy);
    }
    ctx.closePath();
  }

  // The moon: a textured disc (static/moon.png) clipped to a circle, with the
  // unlit side dimmed to a faint earthshine along the real terminator. A soft
  // breathing halo and a very slow drift/bob keep it from feeling pasted-on.
  // Falls back to a flat vector disc until the texture loads. Fades with night.
  private drawMoon(): void {
    const vis = this.theme.star;
    if (vis <= 0.12) return;
    const ctx = this.ctx;
    const t = this.elapsed;
    const R = 4.4 * this.vmin;
    const mx = this.w * 0.7 + Math.sin(t * 0.018) * 1.6 * this.vmin;
    const my = this.h * 0.15 + Math.sin(t * 0.05 + 1) * 0.7 * this.vmin;

    // Synodic month phase in [0,1): 0 = new, 0.5 = full. Anchored on a known
    // new moon (2000-01-06 18:14 UTC). Date-level precision is plenty here.
    const SYNODIC = 29.530588853 * 86_400_000;
    const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14);
    const phase = ((((Date.now() - NEW_MOON_REF) % SYNODIC) + SYNODIC) % SYNODIC) / SYNODIC;
    const illum = (1 - Math.cos(phase * Math.PI * 2)) / 2; // lit fraction 0..1
    if (illum < 0.04) return; // nothing to draw around the new moon

    // Soft halo, breathing slightly and dimmed by how little of the disc is lit.
    const breathe = 0.85 + 0.15 * Math.sin(t * 0.6);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(mx, my, R * 0.5, mx, my, R * 2.9);
    halo.addColorStop(0, `rgba(226, 228, 236, ${0.12 * vis * illum * breathe})`);
    halo.addColorStop(1, "rgba(226, 228, 236, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(mx, my, R * 2.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (this.moonReady) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, R, 0, Math.PI * 2);
      ctx.clip();
      const draw = R * 2 * 1.08; // slight overscan so the disc fills the clip
      ctx.globalAlpha = Math.min(1, vis * 1.15);
      ctx.drawImage(this.moonImg, mx - draw / 2, my - draw / 2, draw, draw);
      ctx.globalAlpha = 1;
      // Earthshine: dim (not erase) the unlit region along the terminator.
      this.tracePhase(mx, my, R, phase, false);
      ctx.fillStyle = "rgba(3, 4, 9, 0.84)";
      ctx.fill();
      ctx.restore();
    } else {
      // Flat vector disc until the texture loads.
      this.tracePhase(mx, my, R, phase, true);
      ctx.save();
      ctx.shadowBlur = 8;
      ctx.shadowColor = `rgba(232, 230, 220, ${0.4 * vis})`;
      const g = ctx.createLinearGradient(mx, my - R, mx, my + R);
      g.addColorStop(0, `rgba(232, 230, 220, ${0.85 * vis})`);
      g.addColorStop(1, `rgba(232, 230, 220, ${0.6 * vis})`);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.reduced) this.renderStatic();
    else this.loop();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  // Runtime toggle (config panel). Safe to call before or after start().
  setReduced(reduced: boolean): void {
    if (this.reduced === reduced) return;
    this.reduced = reduced;
    cancelAnimationFrame(this.raf);
    if (!this.running) return;
    if (reduced) this.renderStatic();
    else this.loop();
  }

  private loop = () => {
    if (this.reduced) return;
    this.renderFrame();
    this.raf = requestAnimationFrame(this.loop);
  };

  private spawnEmber(): Ember {
    const v = this.vmin;
    return {
      x: this.cx + (Math.random() - 0.5) * 3 * v, // tighter column
      y: this.cy + Math.random() * 1.5 * v,
      vx: (Math.random() - 0.5) * 0.25 * v,
      vy: -(0.5 + Math.random() * 1.0) * v,
      life: 45 + Math.random() * 70,
      maxLife: 0,
      size: 0.5 + Math.random() * 1.1,
      hue: 14 + Math.random() * 22,
    };
  }

  private ensureEmbers(): void {
    while (this.embers.length < EMBER_COUNT) {
      const e = this.spawnEmber();
      e.maxLife = e.life;
      this.embers.push(e);
    }
  }

  private flicker(t: number): number {
    return Math.sin(t * 5.1) * 0.4 + Math.sin(t * 7.3) * 0.3 + Math.sin(t * 11.2) * 0.2;
  }

  private drawWaves(): void {
    const ctx = this.ctx;
    const w = this.w;
    const wc = this.theme.wave;
    const step = Math.max(4, Math.floor(w / 240));
    const tideOffset = Math.sin(this.elapsed * 0.008) * 0.012;
    for (const layer of this.waves) {
      const baseY = this.h * (layer.baseY + tideOffset);
      const amp = layer.amp * this.vmin;
      const k = (layer.freq * Math.PI * 2) / w;
      ctx.beginPath();
      for (let x = 0; x <= w; x += step) {
        const y = baseY + Math.sin(x * k + layer.phase) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (layer.filled) {
        ctx.lineTo(w, this.h);
        ctx.lineTo(0, this.h);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, baseY - amp, 0, this.h);
        grad.addColorStop(0, `rgba(${wc[0]}, ${wc[1]}, ${wc[2]}, ${layer.alpha})`);
        grad.addColorStop(1, `rgba(${wc[0]}, ${wc[1]}, ${wc[2]}, 0)`);
        ctx.fillStyle = grad;
        ctx.fill();
      } else {
        ctx.strokeStyle = `rgba(${wc[0]}, ${wc[1]}, ${wc[2]}, ${layer.alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (!this.reduced) layer.phase += layer.speed * 0.06;
    }
  }

  private drawCampfireGlow(t: number, boost: number): void {
    const ctx = this.ctx;
    const flick = this.flicker(t);
    const baseR = 16 * this.vmin * boost;
    const r = baseR * (1 + 0.04 * flick);
    const grad = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, r);
    grad.addColorStop(0, `rgba(255, 90, 54, ${0.28 + 0.06 * flick})`);
    grad.addColorStop(0.35, "rgba(255, 90, 54, 0.10)");
    grad.addColorStop(1, "rgba(255, 90, 54, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Abstract glowing source: soft additive radial cores with a gentle flicker.
  // No logs/flames — keeps it in the app's minimal, particle/glow language.
  private drawCore(t: number, boost: number): void {
    const ctx = this.ctx;
    const v = this.vmin;
    const x = this.cx;
    const y = this.cy;
    const flick = this.flicker(t);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const r1 = (4.6 + 0.5 * flick) * v * boost;
    const g1 = ctx.createRadialGradient(x, y, 0, x, y, r1);
    g1.addColorStop(0, `rgba(255, 170, 100, ${0.42 + 0.12 * flick})`);
    g1.addColorStop(0.5, `rgba(255, 110, 60, ${0.18 + 0.07 * flick})`);
    g1.addColorStop(1, "rgba(255, 90, 54, 0)");
    ctx.fillStyle = g1;
    ctx.beginPath();
    ctx.arc(x, y, r1, 0, Math.PI * 2);
    ctx.fill();

    const r2 = (1.7 + 0.3 * flick) * v * boost;
    const g2 = ctx.createRadialGradient(x, y - 0.4 * v, 0, x, y, r2);
    g2.addColorStop(0, `rgba(255, 240, 205, ${0.5 + 0.16 * flick})`);
    g2.addColorStop(1, "rgba(255, 200, 130, 0)");
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(x, y, r2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private updateAndDrawEmbers(): void {
    const ctx = this.ctx;
    const v = this.vmin;
    // Distance threshold for an ember "kissing" a pastille. Tuned so it
    // triggers a few times per minute without being constant.
    const kissR = 2.2 * v;
    const kissR2 = kissR * kissR;
    for (const e of this.embers) {
      e.x += e.vx;
      e.y += e.vy;
      e.vy -= 0.004 * v;
      e.vx += this.wind * 0.05 * v;
      e.vx *= 0.99;
      e.life -= 1;
      if (e.life <= 0) {
        const fresh = this.spawnEmber();
        e.x = fresh.x;
        e.y = fresh.y;
        e.vx = fresh.vx;
        e.vy = fresh.vy;
        e.life = fresh.life;
        e.maxLife = fresh.life;
        e.size = fresh.size;
        e.hue = fresh.hue;
        continue;
      }
      const p = e.life / e.maxLife;
      const alpha = p * 0.7;
      ctx.fillStyle = `hsla(${e.hue}, 90%, 60%, ${alpha})`;
      ctx.shadowBlur = 4;
      ctx.shadowColor = "rgba(255, 90, 54, 0.5)";
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
      ctx.fill();

      // D — ember/pastille collision: light up the oscillator it crossed.
      for (const o of this.oscs.values()) {
        if (o.alpha < 0.05 || o.trail.length === 0) continue;
        const head = o.trail[o.trail.length - 1]!;
        const dx = head.x - e.x;
        const dy = head.y - e.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < kissR2) {
          // A very delicate twinkle — small and on its own channel so it never
          // overwhelms the pastille or clashes with the "spoke" bloom.
          o.flash = Math.min(0.35, o.flash + 0.12);
          // nudge the ember aside so it doesn't re-trigger every frame
          e.vx += (dx / Math.sqrt(d2 || 1)) * 0.4 * v;
          e.vy += (dy / Math.sqrt(d2 || 1)) * 0.4 * v;
        }
      }
    }
    ctx.shadowBlur = 0;
  }

  private drawOscillators(globalSpeed: number, globalAmp: number): void {
    const ctx = this.ctx;
    const ampX = OSC_AMP_X * this.vmin;
    const ampY = OSC_AMP_Y * this.vmin;
    const t = this.elapsed;

    for (const o of this.oscs.values()) {
      o.alpha += (o.alphaTarget - o.alpha) * 0.05;
      if (o.alphaTarget === 0 && o.alpha < 0.02) {
        this.oscs.delete(o.visitorId);
        continue;
      }
      o.t += 0.016 * o.speed * globalSpeed;
      o.phase += o.driftSpeed * 0.01;

      // Slow seat wander: pick a new target inside a disk around the home
      // seat every few seconds, and ease toward it.
      if (t >= o.seatNextTurn) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * SEAT_WANDER;
        o.seatTargetX = o.seatHomeX + Math.cos(ang) * r;
        o.seatTargetY = o.seatHomeY + Math.sin(ang) * r * 0.7;
        o.seatNextTurn =
          t + SEAT_TURN_MIN + Math.random() * (SEAT_TURN_MAX - SEAT_TURN_MIN);
      }
      o.seatX += (o.seatTargetX - o.seatX) * 0.006;
      o.seatY += (o.seatTargetY - o.seatY) * 0.006;

      // Effect decay: the ember twinkle fades fast, the speak/nudge bloom
      // fades a touch slower for a softer glow.
      if (o.flash > 0) o.flash *= 0.9;
      if (o.bloom > 0) o.bloom *= 0.92;

      const sx = this.cx + o.seatX * this.vmin;
      const sy = this.cy + o.seatY * this.vmin;
      const x = sx + Math.sin(o.t * o.a + o.phase) * ampX * o.ax * globalAmp;
      const y = sy + Math.sin(o.t * o.b) * ampY * o.ay * globalAmp;

      o.trail.push({ x, y });
      if (o.trail.length > TRAIL_LEN) o.trail.shift();

      const headAlpha = o.baseAlpha * o.alpha;
      const lift = 1 + o.bloom * 1.3 + o.flash * 0.5;
      const trail = o.trail;
      const len = trail.length;
      // Trail flicker: modulate segment alpha with a slow wave per oscillator.
      const flickerWave = 0.85 + 0.15 * Math.sin(t * 8 + o.phase);
      for (let i = 1; i < len; i++) {
        const p0 = trail[i - 1]!;
        const p1 = trail[i]!;
        const segAlpha = (i / len) * headAlpha * 0.7 * flickerWave;
        ctx.strokeStyle = hsla(o.hue, 30, 72, segAlpha);
        ctx.lineWidth = 1.1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      const head = trail[len - 1]!;
      const pulse = 1 + 0.18 * Math.sin(t * 3 + o.phase);
      const typingBoost = this.typing.has(o.visitorId) ? 1.4 : 1;
      const headR = 1.8 * pulse * lift * typingBoost;

      // Soft halo (additive) — larger, low-alpha ring that gives a diffuse
      // glow and reacts to the per-visitor hue.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const haloR = headR * 3.2;
      const halo = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, haloR);
      halo.addColorStop(0, hsla(o.hue, 45, 70, 0.22 * headAlpha * lift));
      halo.addColorStop(1, hsla(o.hue, 45, 70, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(head.x, head.y, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Solid head dot on top.
      ctx.fillStyle = hsla(o.hue, 40, 80, headAlpha * lift);
      ctx.shadowBlur = 6;
      ctx.shadowColor = hsla(o.hue, 45, 70, 0.6);
      ctx.beginPath();
      ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Your own pastille: a thin, gently breathing marker ring.
      if (o.visitorId === this.selfId) {
        const ringR = headR * 2.6 + 1.2 * Math.sin(t * 1.6 + o.phase);
        ctx.strokeStyle = hsla(o.hue, 48, 80, 0.4 * o.alpha);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(head.x, head.y, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Nudge ripple: expanding ring that fades out over ~1s.
      if (o.rippleT !== undefined && o.rippleT < 1) {
        const rr = headR + (headR * 8 - headR) * o.rippleT;
        const ra = (1 - o.rippleT) * 0.6;
        ctx.strokeStyle = hsla(o.hue, 50, 75, ra);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(head.x, head.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        o.rippleT += 0.04;
        if (o.rippleT >= 1) o.rippleT = undefined;
      }
    }
  }

  private renderFrame() {
    this.elapsed += 0.016;
    const t = this.elapsed;
    const n = this.lastCount;
    const boost = 1 + Math.min(n, 12) * 0.03;
    const globalSpeed = 1 + Math.min(n, 12) * 0.03;
    const globalAmp = 1 + Math.min(n, 12) * 0.025;

    // A faint, slow breeze — just enough to lean the embers and shift the stars
    // a hair. Kept very gentle on purpose.
    this.wind = Math.sin(t * 0.08) * 0.5 + Math.sin(t * 0.043) * 0.3;

    this.paintSky();
    this.drawNebula();
    this.drawStars();
    this.drawShootingStars();
    this.drawMoon();

    this.drawWaves();
    this.drawCampfireGlow(t, boost);
    this.drawCore(t, boost);
    this.ensureEmbers();
    this.drawOscillators(globalSpeed, globalAmp);
    this.updateAndDrawEmbers();
  }

  private renderStatic() {
    const ctx = this.ctx;
    this.paintSky();
    this.drawNebula();
    this.drawStars();
    this.drawMoon();
    const n = this.lastCount;
    const boost = 1 + Math.min(n, 12) * 0.03;

    this.drawWaves();
    this.drawCampfireGlow(0, boost);
    this.drawCore(0, boost);

    const ampX = OSC_AMP_X * this.vmin;
    const ampY = OSC_AMP_Y * this.vmin;
    for (const o of this.oscs.values()) {
      o.alpha = o.baseAlpha;
      const sx = this.cx + o.seatHomeX * this.vmin;
      const sy = this.cy + o.seatHomeY * this.vmin;
      const x = sx + Math.sin(o.t * o.a + o.phase) * ampX * o.ax;
      const y = sy + Math.sin(o.t * o.b) * ampY * o.ay;
      const headR = 1.8 * (this.typing.has(o.visitorId) ? 1.4 : 1);
      ctx.fillStyle = hsla(o.hue, 40, 80, o.baseAlpha);
      ctx.beginPath();
      ctx.arc(x, y, headR, 0, Math.PI * 2);
      ctx.fill();
      if (o.visitorId === this.selfId) {
        ctx.strokeStyle = hsla(o.hue, 48, 80, 0.4 * o.baseAlpha);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, headR * 2.6, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Static ripple: render at full size if a nudge is pending.
      if (o.rippleT !== undefined) {
        ctx.strokeStyle = hsla(o.hue, 50, 75, 0.3);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, headR * 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}
