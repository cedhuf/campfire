// Popover anchored under the daybar time: shows the server's local time, the
// current day phase, and the list of present visitors (each as a colored dot —
// the same hue as their on-canvas marker — with how long they've been around).
import { hueForVisitor, hsla } from "./color";
import { t } from "./i18n";
import type { Theme } from "./theme";

type PresenceItem = { visitorId: string; seatIndex: number; connectedAt: number };

export class Presents {
  private root: HTMLElement;
  private timeEl: HTMLElement;
  private phaseEl: HTMLElement;
  private listEl: HTMLElement;
  private countEl: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private presence: Map<string, PresenceItem>;
  private selfId: () => string;
  private serverNow: () => number;
  private onNudge: (visitorId: string) => void;
  private hintEl: HTMLElement | null;
  private raf = 0;

  constructor(
    root: HTMLElement,
    presence: Map<string, PresenceItem>,
    selfId: () => string,
    serverNow: () => number,
    onNudge: (visitorId: string) => void = () => {},
  ) {
    this.root = root;
    this.presence = presence;
    this.selfId = selfId;
    this.serverNow = serverNow;
    this.onNudge = onNudge;
    this.timeEl = root.querySelector(".presents-time") as HTMLElement;
    this.phaseEl = root.querySelector(".presents-phase") as HTMLElement;
    this.listEl = root.querySelector(".presents-list") as HTMLElement;
    this.countEl = root.querySelector(".presents-count") as HTMLElement;
    this.hintEl = root.querySelector(".presents-hint");
    this.closeBtn = root.querySelector(".presents-close") as HTMLButtonElement;
    this.closeBtn.addEventListener("click", () => this.close());
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });
  }

  open(): void {
    this.root.hidden = false;
    // Force reflow so the transition runs from the initial state.
    void this.root.offsetWidth;
    this.root.classList.add("open");
    this.lastSig = "";
    this.renderList();
    this.startTick();
    this.closeBtn.focus();
  }

  close(): void {
    this.root.classList.remove("open");
    cancelAnimationFrame(this.raf);
    // Hide after the transition ends to allow the fade-out.
    setTimeout(() => {
      if (!this.root.classList.contains("open")) this.root.hidden = true;
    }, 220);
  }

  isOpen(): boolean {
    return this.root.classList.contains("open");
  }

  private startTick(): void {
    const tick = () => {
      this.renderList();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  // Header (time + phase) is updated externally by main.ts's tickTime().
  renderHeader(frac: number, theme: Theme): void {
    const totalMin = Math.floor(frac * 1440);
    const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
    const mm = String(totalMin % 60).padStart(2, "0");
    this.timeEl.textContent = `${hh}:${mm}`;
    this.phaseEl.textContent = t("phase_" + theme.phase);
    this.countEl.textContent = String(this.presence.size).padStart(2, "0");
  }

  private renderList(): void {
    const now = this.serverNow();
    const self = this.selfId();
    const items = Array.from(this.presence.values()).sort((a, b) => a.connectedAt - b.connectedAt);
    // The "tap to wave" hint only makes sense when there's someone else here.
    if (this.hintEl) this.hintEl.hidden = items.length <= 1;
    // Rebuild only if the set or order changed since last render.
    const sig = items.map((p) => p.visitorId).join(",");
    if (sig === this.lastSig) {
      // Just refresh durations in place.
      const rows = this.listEl.querySelectorAll<HTMLElement>(".present-row");
      rows.forEach((row, i) => {
        const p = items[i];
        if (p) row.querySelector<HTMLElement>(".present-dur")!.textContent = this.duration(now - p.connectedAt);
      });
      return;
    }
    this.lastSig = sig;
    this.listEl.innerHTML = "";
    for (const p of items) {
      const isSelf = p.visitorId === self;
      // Others are buttons: tap to wave. Self is a plain, non-interactive row.
      const row = document.createElement(isSelf ? "div" : "button");
      row.className = "present-row" + (isSelf ? " is-self" : "");
      const dot = document.createElement("span");
      dot.className = "present-dot";
      const hue = hueForVisitor(p.visitorId);
      dot.style.background = hsla(hue, 45, 70, 1);
      dot.style.boxShadow = `0 0 6px ${hsla(hue, 50, 65, 0.55)}`;
      const dur = document.createElement("span");
      dur.className = "present-dur";
      dur.textContent = this.duration(now - p.connectedAt);
      const tag = document.createElement("span");
      tag.className = "present-tag";
      tag.textContent = isSelf ? t("you") : t("wave");
      row.appendChild(dot);
      row.appendChild(dur);
      row.appendChild(tag);
      if (!isSelf) {
        (row as HTMLButtonElement).type = "button";
        row.setAttribute("aria-label", `${t("wave")} — ${p.visitorId.slice(0, 6)}`);
        row.addEventListener("click", () => this.onNudge(p.visitorId));
      }
      this.listEl.appendChild(row);
    }
  }

  private lastSig = "";

  private duration(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 30) return t("just_now");
    const m = Math.floor(s / 60);
    if (m < 1) return t("just_now");
    if (m < 60) return `${m} ${t("min")}`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (mm === 0) return `${h} ${t("hour")}`;
    return `${h} ${t("hour")} ${mm} ${t("min")}`;
  }
}
