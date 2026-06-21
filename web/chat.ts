const MAX_CLASSIC = 10;
const MAX_AIR = 10;
const LIFETIME_CLASSIC = 50_000;
const LIFETIME_AIR = 60_000;

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
  private onTyping: (typing: boolean) => void;
  private messages: MsgEl[] = [];
  private selfId = "";
  private mode: ChatMode = "air";
  private typingTimer = 0;
  private typingSent = false;

  constructor(
    log: HTMLElement,
    air: HTMLElement,
    input: HTMLInputElement,
    form: HTMLFormElement,
    onSend: (text: string) => void,
    onTyping: (typing: boolean) => void = () => {},
  ) {
    this.log = log;
    this.air = air;
    this.input = input;
    this.form = form;
    this.onSend = onSend;
    this.onTyping = onTyping;
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submit();
    });
    // Reveal the send button only when there's something to send or the
    // field is focused — keeps the input visually bare at rest.
    const sync = () => {
      const has = this.input.value.trim().length > 0;
      this.form.classList.toggle("has-input", has);
      // Character counter: only visible past 80% of maxLength.
      const len = this.input.value.length;
      const max = this.input.maxLength || 140;
      const counter = this.form.querySelector<HTMLElement>(".chat-counter");
      if (counter) {
        if (len > max * 0.8) {
          counter.hidden = false;
          counter.textContent = String(max - len);
          counter.classList.toggle("is-near", len >= max - 10);
        } else {
          counter.hidden = true;
        }
      }
    };
    this.input.addEventListener("input", () => {
      sync();
      this.emitTyping();
    });
    this.input.addEventListener("focus", () => this.form.classList.add("has-input"));
    this.input.addEventListener("blur", sync);
  }

  // Signal typing on the rising edge only (one message per burst), then let the
  // idle timeout clear it — instead of emitting on every keystroke.
  private emitTyping(): void {
    if (!this.typingSent) {
      this.typingSent = true;
      this.onTyping(true);
    }
    clearTimeout(this.typingTimer);
    this.typingTimer = window.setTimeout(() => this.stopTyping(), 1500);
  }

  private stopTyping(): void {
    clearTimeout(this.typingTimer);
    if (!this.typingSent) return;
    this.typingSent = false;
    this.onTyping(false);
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
    this.form.classList.remove("has-input");
    const counter = this.form.querySelector<HTMLElement>(".chat-counter");
    if (counter) counter.hidden = true;
    // Stop the typing signal immediately — the message is on its way.
    this.stopTyping();
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
    // Rise range: messages drift further up the screen so they live in the
    // scene longer. Clamped on mobile (smaller viewport) so they stay clear of
    // the daybar / top controls.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const riseMin = coarse ? 30 : 42;
    const riseMax = coarse ? 42 : 54;
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
      // ease in, long hold, ease out (held visible most of its life)
      let op: number;
      if (p < 0.08) op = p / 0.08;
      else if (p > 0.78) op = (1 - p) / 0.22;
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
