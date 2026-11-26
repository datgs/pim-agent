import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

export class ActivityDetail implements Component {
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    private title: string,
    private bullets: readonly string[],
    private theme: Theme,
    private onClose: () => void
  ) {}

  handleInput(data: string): void {
    if (data === "\x1b") {
      this.onClose();
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    // Read-only view: any click inside dismisses; "[x]" marks that affordance.
    if (event.type === "click") {
      this.onClose();
      return { handled: true };
    }
    return undefined;
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
    const inner = Math.max(20, width - 2);
    const border = (s: string): string => theme.fg("muted", s);
    const row = (content: string, color: "dim" | "muted"): string => {
      const maxText = inner - 1;
      const clipped =
        visibleWidth(content) > maxText
          ? truncateToWidth(content, maxText, "…")
          : content;
      const padded =
        " " +
        clipped +
        " ".repeat(Math.max(1, inner - 1 - visibleWidth(clipped)));
      return border("│") + theme.fg(color, padded) + border("│");
    };

    const heading = `─ ${this.title} `;
    const close = "[x]";
    const topRemain = Math.max(
      1,
      inner - visibleWidth(heading) - visibleWidth(close) - 1
    );
    const lines: string[] = [
      border(`┌${heading}${"─".repeat(topRemain)} `) +
        theme.fg("dim", close) +
        border("┐"),
    ];

    for (const bullet of this.bullets) {
      for (const line of wrapTextWithAnsi(`• ${bullet}`, inner)) {
        lines.push(row(line, "dim"));
      }
    }

    lines.push(border(`└${"─".repeat(inner)}┘`));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}
