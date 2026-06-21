const MAX_CLASSIC = 10;
const MAX_AIR = 10;
const LIFETIME_CLASSIC = 50_000;
const LIFETIME_AIR = 40_000;

import { hueForVisitor, hsla } from "./color";

export type ChatMode = "air" | "classic";

type MsgEl = {
  el: HTMLElement;
  bornAt: number;
  raf: number;
  dead: boolean;
  mode: ChatMode;
  drift: number; // px horizontal drift over life (air)
  rise: number; // vh vertical rise over life (air)
};

export class Chat {
  private log: HTMLElement;
  private air: HTMLElement;
  private input: HTMLInputElement;
  private form: HTMLFormElement;
  private onSend: (text: string) => void;
  private messages: MsgEl[] = [];
  private selfId = "";
  private mode: ChatMode = "air";

  constructor(
    log: HTMLElement,
    air: HTMLElement,
    input: HTMLInputElement,
    form: HTMLFormElement,
    onSend: (text: string) => void,
  ) {
    this.log = log;
    this.air = air;
    this.input = input;
    this.form = form;
    this.onSend = onSend;
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submit();
    });
  }

  setSelf(visitorId: string): void {
    this.selfId = visitorId;
  }

  setMode(mode: ChatMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // Ephemeral: clear whatever is currently showing on switch.
    for (const m of [...this.messages]) this.kill(m);
    document.documentElement.dataset.chat = mode;
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.onSend(text);
    this.input.value = "";
  }

  add(visitorId: string, text: string, ts: number): void {
    if (this.mode === "air") this.addAir(visitorId, text);
    else this.addClassic(visitorId, text, ts);
  }

  private addClassic(visitorId: string, text: string, ts: number): void {
    const el = document.createElement("div");
    const isSelf = visitorId === this.selfId;
    el.className = "chat-msg" + (isSelf ? " is-self" : "");
    const hue = hueForVisitor(visitorId);
    el.style.color = hsla(hue, 32, isSelf ? 86 : 78, 1);
    const tsSpan = document.createElement("span");
    tsSpan.className = "ts";
    tsSpan.textContent = this.fmtTime(ts);
    const span = document.createElement("span");
    span.textContent = text;
    el.appendChild(tsSpan);
    el.appendChild(span);
    this.log.appendChild(el);
    const entry: MsgEl = { el, bornAt: performance.now(), raf: 0, dead: false, mode: "classic", drift: 0, rise: 0 };
    this.messages.push(entry);
    while (this.messages.length > MAX_CLASSIC) {
      const oldest = this.messages.shift();
      if (oldest) this.kill(oldest);
    }
    this.animate(entry);
  }

  private addAir(visitorId: string, text: string): void {
    const el = document.createElement("div");
    const isSelf = visitorId === this.selfId;
    el.className = "air-msg" + (isSelf ? " is-self" : "");
    const hue = hueForVisitor(visitorId);
    el.style.color = hsla(hue, 38, isSelf ? 90 : 82, 0.94);
    el.textContent = text;
    const leftPct = 50 + (Math.random() * 2 - 1) * 20; // 30%..70%
    el.style.left = leftPct + "%";
    this.air.appendChild(el);
    // Rise range: full on desktop, clamped on mobile (smaller viewport, keep
    // the message clear of the daybar/brackets at the top).
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const riseMin = coarse ? 22 : 28;
    const riseMax = coarse ? 28 : 38;
    const entry: MsgEl = {
      el,
      bornAt: performance.now(),
      raf: 0,
      dead: false,
      mode: "air",
      drift: (Math.random() * 2 - 1) * 8,
      rise: riseMin + Math.random() * (riseMax - riseMin),
    };
    this.messages.push(entry);
    while (this.messages.length > MAX_AIR) {
      const oldest = this.messages.shift();
      if (oldest) this.kill(oldest);
    }
    this.animateAir(entry);
  }

  private fmtTime(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  private animate(entry: MsgEl): void {
    const tick = () => {
      if (entry.dead) return;
      const age = performance.now() - entry.bornAt;
      const p = Math.min(age / LIFETIME_CLASSIC, 1);
      entry.el.style.opacity = String(1 - p);
      entry.el.style.transform = `translateY(${-p * 14}px)`;
      if (p >= 1) {
        this.kill(entry);
        return;
      }
      entry.raf = requestAnimationFrame(tick);
    };
    entry.raf = requestAnimationFrame(tick);
  }

  private animateAir(entry: MsgEl): void {
    const tick = () => {
      if (entry.dead) return;
      const age = performance.now() - entry.bornAt;
      const p = Math.min(age / LIFETIME_AIR, 1);
      // ease in, hold, ease out
      let op: number;
      if (p < 0.10) op = p / 0.10;
      else if (p > 0.65) op = (1 - p) / 0.35;
      else op = 1;
      const ty = -p * entry.rise; // vh, rises upward
      const tx = entry.drift * p; // gentle horizontal sway
      entry.el.style.opacity = String(Math.max(0, op));
      entry.el.style.transform = `translate(calc(-50% + ${tx}px), ${ty}vh)`;
      if (p >= 1) {
        this.kill(entry);
        return;
      }
      entry.raf = requestAnimationFrame(tick);
    };
    entry.raf = requestAnimationFrame(tick);
  }

  private kill(entry: MsgEl): void {
    entry.dead = true;
    cancelAnimationFrame(entry.raf);
    entry.el.remove();
    const idx = this.messages.indexOf(entry);
    if (idx >= 0) this.messages.splice(idx, 1);
  }

  focus(): void {
    this.input.focus();
  }
}
