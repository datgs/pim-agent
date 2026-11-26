import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { MouseRegion, type TUI } from "@earendil-works/pi-tui";
import { ActivityPill } from "./box";
import { ActivityDetail } from "./detail";
import { buildActivitySummary, type ActivitySummary } from "./summary";

const WIDGET_ID = "pim-activity";

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
  let lastCtx: ExtensionContext | undefined;
  let lastTui: TUI | undefined;

  const openDetail = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI || !summary || summary.bullets.length === 0) {
      return;
    }
    const bullets = summary.bullets;
    const wide = (lastTui?.terminal.columns ?? 0) >= 100;
    ctx.ui.custom(
      (_tui, theme, _keybindings, done) =>
        new ActivityDetail("Current Activity", bullets, theme, () =>
          done(undefined)
        ),
      {
        overlay: true,
        overlayOptions: {
          anchor: wide ? "right-center" : "center",
          width: wide ? "40%" : "80%",
          minWidth: 40,
        },
      }
    );
  };

  const render = (ctx: ExtensionContext): void => {
    lastCtx = ctx;
    if (!ctx.hasUI || !enabled || !summary || summary.bullets.length === 0) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }
    ctx.ui.setWidget(WIDGET_ID, (tui, theme) => {
      lastTui = tui;
      const pill = new ActivityPill("Activity", theme);
      return new MouseRegion(pill, (event) => {
        if (event.type === "click" && lastCtx) {
          openDetail(lastCtx);
          return { handled: true };
        }
        return undefined;
      });
    });
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
    messages = messagesFromBranch(ctx.sessionManager.getBranch());
    recompute(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    messages.push(event.message);
    recompute(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
    }
  });

  pi.registerCommand("activity", {
    description:
      "Show/toggle the activity button above the composer: /activity [on|off]",
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
