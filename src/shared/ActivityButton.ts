/**
 * Cross-module bridge between the activity-summary extension and the
 * powerline editor. The extension registers availability and the open
 * callback; the editor renders the button into its bottom border and
 * routes clicks back.
 */
export class ActivityButton {
  private static shown = false;
  private static onOpen: (() => void) | undefined;

  public static register(onOpen: () => void): void {
    this.onOpen = onOpen;
  }

  public static setShown(shown: boolean): void {
    this.shown = shown;
  }

  public static isShown(): boolean {
    return this.shown && this.onOpen !== undefined;
  }

  public static open(): void {
    if (this.shown) {
      this.onOpen?.();
    }
  }
}
