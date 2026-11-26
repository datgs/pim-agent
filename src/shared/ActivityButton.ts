const KEY = Symbol.for("pim.activity-button");

type State = {
  shown: boolean;
  onOpen?: () => void;
  requestRender?: () => void;
};

/**
 * Cross-module bridge between the activity-summary extension and the
 * powerline editor. Stored on globalThis because the editor and the
 * extension may resolve through different pi module copies, which would
 * otherwise give each side its own statics and the button never appears.
 */
export class ActivityButton {
  private static state(): State {
    const g = globalThis as Record<symbol, State | undefined>;
    g[KEY] ??= { shown: false };
    return g[KEY];
  }

  public static register(onOpen: () => void): void {
    this.state().onOpen = onOpen;
  }

  public static setShown(shown: boolean): void {
    const s = this.state();
    if (s.shown !== shown) {
      s.shown = shown;
      s.requestRender?.();
    }
  }

  public static setRenderTrigger(requestRender: () => void): void {
    this.state().requestRender = requestRender;
  }

  public static isShown(): boolean {
    const s = this.state();
    return s.shown && s.onOpen !== undefined;
  }

  public static open(): void {
    const s = this.state();
    if (s.shown) {
      s.onOpen?.();
    }
  }
}
