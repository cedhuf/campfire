import { rgb, type Theme } from "./theme";
import { t } from "./i18n";

// Top progress bar mapped to the day (0h -> 24h), with a marker tracking "now"
// and a tiny HH:MM / phase readout. Colors follow the active theme.
export class DayBar {
  private root: HTMLElement;
  private fill: HTMLElement;
  private marker: HTMLElement;
  private timeEl: HTMLElement;
  private phaseEl: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.fill = root.querySelector(".daybar-fill") as HTMLElement;
    this.marker = root.querySelector(".daybar-marker") as HTMLElement;
    this.timeEl = root.querySelector(".daybar-time") as HTMLElement;
    this.phaseEl = root.querySelector(".daybar-phase") as HTMLElement;
  }

  update(frac: number, theme: Theme): void {
    const pct = frac * 100;
    this.fill.style.width = pct + "%";
    this.marker.style.left = pct + "%";

    const totalMin = Math.floor(frac * 1440);
    const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
    const mm = String(totalMin % 60).padStart(2, "0");
    this.timeEl.textContent = `${hh}:${mm}`;
    this.phaseEl.textContent = t("phase_" + theme.phase);

    this.root.style.setProperty("--day-accent", rgb(theme.marker));
    this.root.style.setProperty("--day-glow", rgb(theme.marker, 0.5));
  }
}
