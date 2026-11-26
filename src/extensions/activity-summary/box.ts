import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";

const BULLET = "•";

export class ActivityBox implements Component {
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    private title: string,
    private bullets: readonly string[],
    private theme: Theme
  ) {}

  setContent(title: string, bullets: readonly string[]): void {
    this.title = title;
    this.bullets = bullets;
    this.invalidate();
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    const theme = this.theme;
    const inner = Math.max(10, width - 2);
    const border = (s: string): string => theme.fg("muted", s);
    const heading = `─ ${this.title} `;
    const topRemain = Math.max(1, inner - visibleWidth(heading));
    const lines = [
      border(`┌${heading}${"─".repeat(topRemain)}┐`),
      ...this.bullets.map((b) => {
        const text = `${BULLET} ${b}`;
        const maxText = inner - 2;
        const clipped =
          visibleWidth(text) > maxText
            ? truncateToWidth(text, maxText, "…")
            : text;
        const padded =
          " " +
          clipped +
          " ".repeat(Math.max(1, inner - 1 - visibleWidth(clipped)));
        return border("│") + theme.fg("dim", padded) + border("│");
      }),
      border(`└${"─".repeat(inner)}┘`),
      "",
    ];
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}
