import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";

export class ActivityPill implements Component {
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    private label: string,
    private theme: Theme
  ) {}

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    const pill = this.theme.fg("dim", `[${this.label}]`);
    const pad = " ".repeat(Math.max(0, width - visibleWidth(pill) - 1));
    const lines = [pad + pill, ""];
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}
