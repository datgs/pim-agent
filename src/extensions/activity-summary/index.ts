import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { ActivityLine } from "../../shared/ActivityLine";
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

  const render = (ctx: ExtensionContext): void => {
    const text =
      ctx.hasUI && enabled && summary && summary.bullets.length > 0
        ? summary.bullets.join(" · ")
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
    messages = messagesFromBranch(ctx.sessionManager.getBranch());
    recompute(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    messages.push(event.message);
    recompute(ctx);
  });

  pi.on("session_shutdown", () => {
    ActivityLine.setText(undefined);
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
