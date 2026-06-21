const MAX_MESSAGES = 10;
const LIFETIME_MS = 50_000;

type MsgEl = { el: HTMLElement; bornAt: number; raf: number; dead: boolean };

export class Chat {
  private log: HTMLElement;
  private input: HTMLInputElement;
  private form: HTMLFormElement;
  private onSend: (text: string) => void;
  private messages: MsgEl[] = [];
  private selfId = "";

  constructor(log: HTMLElement, input: HTMLInputElement, form: HTMLFormElement, onSend: (text: string) => void) {
    this.log = log;
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

  private submit(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.onSend(text);
    this.input.value = "";
  }

  add(visitorId: string, text: string, ts: number): void {
    const el = document.createElement("div");
    el.className = "chat-msg" + (visitorId === this.selfId ? " is-self" : "");
    const tsSpan = document.createElement("span");
    tsSpan.className = "ts";
    tsSpan.textContent = this.fmtTime(ts);
    const span = document.createElement("span");
    span.textContent = text;
    el.appendChild(tsSpan);
    el.appendChild(span);
    // column-reverse: newest at bottom. Append to end of container = bottom visually.
    this.log.appendChild(el);
    const entry: MsgEl = { el, bornAt: performance.now(), raf: 0, dead: false };
    this.messages.push(entry);
    this.prune();
    this.animate(entry);
  }

  private fmtTime(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  private prune(): void {
    while (this.messages.length > MAX_MESSAGES) {
      const oldest = this.messages.shift();
      if (oldest) this.kill(oldest);
    }
  }

  private animate(entry: MsgEl): void {
    const tick = () => {
      if (entry.dead) return;
      const age = performance.now() - entry.bornAt;
      const p = Math.min(age / LIFETIME_MS, 1);
      const opacity = 1 - p;
      const ty = -p * 14;
      entry.el.style.opacity = String(opacity);
      entry.el.style.transform = `translateY(${ty}px)`;
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
