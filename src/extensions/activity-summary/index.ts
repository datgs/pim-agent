import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { ActivityLine } from "../../shared/ActivityLine";

const REVIEW_WIDGET_ID = "pim-activity-review";
import { buildActivitySummary, type ActivitySummary } from "./summary";

function messagesFromBranch(entries: readonly SessionEntry[]): AgentMessage[] {
  return entries
    .filter(
      (e): e is Extract<SessionEntry, { type: "message" }> =>
        e.type === "message"
    )
    .map((e) => e.message);
}

export default function (pi: ExtensionAPI): void {
  let summary: ActivitySummary | null = null;
  let messages: AgentMessage[] = [];
  let enabled = true;
  let reviewShown = false;

  const hideReview = (ctx: ExtensionContext): void => {
    if (reviewShown) {
      ctx.ui.setWidget(REVIEW_WIDGET_ID, undefined);
      reviewShown = false;
    }
  };

  const showReview = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI || !summary || summary.bullets.length === 0) {
      return;
    }
    const theme = ctx.ui.theme;
    ctx.ui.setWidget(
      REVIEW_WIDGET_ID,
      () => new Text(theme.fg("dim", summary!.bullets.join("\n")), 1, 0)
    );
    reviewShown = true;
  };

  const render = (ctx: ExtensionContext): void => {
    ActivityLine.setOnOpen(() => showReview(ctx));
    // The border is one row: show the first line of the current item plus
    // an ellipsis when more content exists; the review widget shows it all.
    const firstBullet = summary?.bullets[0] ?? "";
    const firstLine = firstBullet.split("\n")[0] ?? "";
    const hasMore =
      firstBullet.includes("\n") || (summary?.bullets.length ?? 0) > 1;
    const text =
      ctx.hasUI && enabled && firstLine
        ? hasMore
          ? `${firstLine} …`
          : firstLine
        : undefined;
    ActivityLine.setText(text);
  };

  const recompute = (ctx: ExtensionContext): void => {
    summary = buildActivitySummary(messages);
    render(ctx);
  };

  pi.on("session_start", (_event, ctx) => {
    messages = messagesFromBranch(ctx.sessionManager.getBranch());
    recompute(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    hideReview(ctx);
    messages = messagesFromBranch(ctx.sessionManager.getBranch());
    recompute(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    messages.push(event.message);
    recompute(ctx);
  });

  pi.on("input", (_event, ctx) => {
    hideReview(ctx);
    return { action: "continue" };
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setWidget(REVIEW_WIDGET_ID, undefined);
    }
    ActivityLine.setText(undefined);
    ActivityLine.setOnOpen(undefined);
  });

  pi.registerCommand("activity", {
    description:
      "Show/hide the activity caption on the composer status line: /activity [on|off]",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg === "on") {
        enabled = true;
      } else if (arg === "off") {
        enabled = false;
      } else if (arg === "") {
        enabled = !enabled;
      } else {
        ctx.ui.notify("Usage: /activity [on|off]", "warning");
        return;
      }
      render(ctx);
      ctx.ui.notify(
        `Activity summary ${enabled ? "enabled" : "disabled"}`,
        "info"
      );
    },
  });
}
