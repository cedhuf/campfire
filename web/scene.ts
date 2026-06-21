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
  seatX: number;
  seatY: number;
  baseAlpha: number;
  driftSpeed: number;
  alpha: number;
  alphaTarget: number;
  t: number;
  trail: Array<{ x: number; y: number }>;
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

const TRAIL_LEN = 24;
const EMBER_COUNT = 30;
const STAR_COUNT = 80;
const SEAT_RADIUS = 17;
const OSC_AMP_X = 4;
const OSC_AMP_Y = 6;

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

function buildOscillator(visitorId: string, seatIndex: number): Oscillator {
  const seed = fnv1a(visitorId);
  const rng = mulberry32(seed);
  const pair = PAIRS[Math.floor(rng() * PAIRS.length) % PAIRS.length]!;
  const seatAngle = (seatIndex / 6) * Math.PI * 2 - Math.PI / 2;
  return {
    visitorId,
    hue: hueForVisitor(visitorId),
    a: pair[0],
    b: pair[1],
    phase: rng() * Math.PI * 2,
    speed: 0.5 + rng() * 0.5,
    ax: 0.7 + rng() * 0.5,
    ay: 1.2 + rng() * 0.6,
    seatX: Math.cos(seatAngle) * SEAT_RADIUS,
    seatY: Math.sin(seatAngle) * SEAT_RADIUS * 0.65,
    baseAlpha: 0.5 + rng() * 0.35,
    driftSpeed: 0.04 + rng() * 0.06,
    alpha: 0,
    alphaTarget: 1,
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
  private waves: WaveLayer[] = WAVES.map((w) => ({ ...w }));
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
  };

  add(visitorId: string, seatIndex: number): void {
    if (this.oscs.has(visitorId)) return;
    if (seatIndex > 5) return;
    this.oscs.set(visitorId, buildOscillator(visitorId, seatIndex));
    if (this.reduced) this.renderStatic();
  }

  remove(visitorId: string): void {
    const o = this.oscs.get(visitorId);
    if (o) o.alphaTarget = 0;
  }

  setCount(n: number): void {
    this.lastCount = n;
  }

  setTheme(t: Theme): void {
    this.theme = t;
    // Under reduced motion the loop is idle, so repaint the static frame.
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
    for (let i = 0; i < STAR_COUNT; i++) {
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

  private drawStars(): void {
    const alpha = this.theme.star;
    if (alpha <= 0.01) return;
    this.ensureStars();
    const ctx = this.ctx;
    for (const s of this.stars) {
      const tw = this.reduced ? 1 : 0.7 + 0.3 * Math.sin(this.elapsed * s.tw + s.phase);
      ctx.fillStyle = `rgba(222, 226, 238, ${s.a * alpha * tw})`;
      ctx.beginPath();
      ctx.arc(s.fx * this.w, s.fy * this.h, s.r, 0, Math.PI * 2);
      ctx.fill();
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
    for (const layer of this.waves) {
      const baseY = this.h * layer.baseY;
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
    for (const e of this.embers) {
      e.x += e.vx;
      e.y += e.vy;
      e.vy -= 0.004 * v;
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
    }
    ctx.shadowBlur = 0;
  }

  private drawOscillators(globalSpeed: number, globalAmp: number): void {
    const ctx = this.ctx;
    const ampX = OSC_AMP_X * this.vmin;
    const ampY = OSC_AMP_Y * this.vmin;

    for (const o of this.oscs.values()) {
      o.alpha += (o.alphaTarget - o.alpha) * 0.05;
      if (o.alphaTarget === 0 && o.alpha < 0.02) {
        this.oscs.delete(o.visitorId);
        continue;
      }
      o.t += 0.016 * o.speed * globalSpeed;
      o.phase += o.driftSpeed * 0.01;

      const sx = this.cx + o.seatX * this.vmin;
      const sy = this.cy + o.seatY * this.vmin;
      const x = sx + Math.sin(o.t * o.a + o.phase) * ampX * o.ax * globalAmp;
      const y = sy + Math.sin(o.t * o.b) * ampY * o.ay * globalAmp;

      o.trail.push({ x, y });
      if (o.trail.length > TRAIL_LEN) o.trail.shift();

      const headAlpha = o.baseAlpha * o.alpha;
      const trail = o.trail;
      const len = trail.length;
      for (let i = 1; i < len; i++) {
        const p0 = trail[i - 1]!;
        const p1 = trail[i]!;
        const segAlpha = (i / len) * headAlpha * 0.7;
        ctx.strokeStyle = hsla(o.hue, 30, 72, segAlpha);
        ctx.lineWidth = 1.1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      const head = trail[len - 1]!;
      ctx.fillStyle = hsla(o.hue, 40, 80, headAlpha);
      ctx.shadowBlur = 6;
      ctx.shadowColor = hsla(o.hue, 45, 70, 0.6);
      ctx.beginPath();
      ctx.arc(head.x, head.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  private renderFrame() {
    this.elapsed += 0.016;
    const t = this.elapsed;
    const n = this.lastCount;
    const boost = 1 + Math.min(n, 12) * 0.03;
    const globalSpeed = 1 + Math.min(n, 12) * 0.03;
    const globalAmp = 1 + Math.min(n, 12) * 0.025;

    this.paintSky();
    this.drawStars();

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
    this.drawStars();
    const n = this.lastCount;
    const boost = 1 + Math.min(n, 12) * 0.03;

    this.drawWaves();
    this.drawCampfireGlow(0, boost);
    this.drawCore(0, boost);

    const ampX = OSC_AMP_X * this.vmin;
    const ampY = OSC_AMP_Y * this.vmin;
    for (const o of this.oscs.values()) {
      o.alpha = o.baseAlpha;
      const sx = this.cx + o.seatX * this.vmin;
      const sy = this.cy + o.seatY * this.vmin;
      const x = sx + Math.sin(o.t * o.a + o.phase) * ampX * o.ax;
      const y = sy + Math.sin(o.t * o.b) * ampY * o.ay;
      ctx.fillStyle = hsla(o.hue, 40, 80, o.baseAlpha);
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
