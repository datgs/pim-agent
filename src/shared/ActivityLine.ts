const KEY = Symbol.for("pim.activity-line");

type State = {
  text: string | undefined;
  requestRender?: () => void;
};

/**
 * Cross-module bridge between the activity-summary extension and the
 * powerline editor. Stored on globalThis because the editor and the
 * extension may resolve through different pi module copies, which would
 * otherwise give each side its own statics and the caption never appears.
 */
export class ActivityLine {
  private static state(): State {
    const g = globalThis as Record<symbol, State | undefined>;
    g[KEY] ??= { text: undefined };
    return g[KEY];
  }

  public static setText(text: string | undefined): void {
    const s = this.state();
    if (s.text !== text) {
      s.text = text;
      try {
        s.requestRender?.();
      } catch {
        // The editor that registered the trigger may be gone (test harnesses
        // hand a bare tui mock); repaint misses are harmless anyway.
      }
    }
  }

  public static getText(): string | undefined {
    return this.state().text;
  }

  public static setRenderTrigger(requestRender: () => void): void {
    this.state().requestRender = requestRender;
  }

  public static resetForTests(): void {
    (globalThis as Record<symbol, State | undefined>)[KEY] = undefined;
  }
}
