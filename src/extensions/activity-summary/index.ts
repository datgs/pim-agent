import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { ActivityButton } from "../../shared/ActivityButton";
import { ActivityDetail } from "./detail";
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

  const openDetail = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI || !summary || summary.bullets.length === 0) {
      return;
    }
    const bullets = summary.bullets;
    ctx.ui.custom(
      (_tui, theme, _keybindings, done) =>
        new ActivityDetail("Current Activity", bullets, theme, () =>
          done(undefined)
        ),
      {
        overlay: true,
        overlayOptions: () => {
          const wide = (process.stdout.columns ?? 0) >= 100;
          return {
            anchor: wide ? "right-center" : "center",
            width: wide ? "40%" : "80%",
            minWidth: 40,
            nonCapturing: true,
          };
        },
      }
    );
  };

  const render = (ctx: ExtensionContext): void => {
    ActivityButton.register(() => openDetail(ctx));
    ActivityButton.setShown(
      ctx.hasUI && enabled && !!summary && summary.bullets.length > 0
    );
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

  pi.on("session_shutdown", () => {
    ActivityButton.setShown(false);
  });

  pi.registerCommand("activity", {
    description:
      "Show/hide the [Activity] button on the composer status line: /activity [on|off]",
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
