import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
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

  const render = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI || !enabled || !summary || summary.bullets.length === 0) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }
    const theme = ctx.ui.theme;
    const lines = [
      theme.fg("muted", "Activity"),
      ...summary.bullets.map((b) => theme.fg("dim", `• ${b}`)),
      "",
    ];
    ctx.ui.setWidget(WIDGET_ID, lines);
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
    description: "Toggle the activity summary shown above the composer",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      render(ctx);
      ctx.ui.notify(
        `Activity summary ${enabled ? "enabled" : "disabled"}`,
        "info"
      );
    },
  });
}
