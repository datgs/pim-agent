import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import registerActivitySummary from "./index";

const WIDGET_ID = "pim-activity";

type Handler = (event: never, ctx: ExtensionContext) => void;

type Harness = {
  readonly handlers: Map<string, Handler>;
  readonly commands: Map<string, { handler: Function }>;
  readonly widgets: Map<string, string[] | undefined>;
  readonly ctx: ExtensionContext;
  emit(event: string, data?: unknown): void;
};

function harness(branch: readonly SessionEntry[] = []): Harness {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: Function }>();
  const widgets = new Map<string, string[] | undefined>();

  const theme = {
    fg: (_color: string, text: string) => text,
  };

  const setWidget = (
    key: string,
    content:
      | string[]
      | ((tui: unknown, t: typeof theme) => { render(w: number): string[] })
      | undefined
  ): void => {
    if (typeof content === "function") {
      widgets.set(key, content({}, theme).render(60));
      return;
    }
    widgets.set(key, content);
  };

  const ctx = {
    cwd: "/work",
    hasUI: true,
    ui: {
      theme,
      setWidget,
      notify: (): void => {},
    },
    sessionManager: {
      getBranch: () => [...branch],
    },
  } as unknown as ExtensionContext;

  const pi = {
    on(event: string, handler: Handler): void {
      handlers.set(event, handler);
    },
    registerCommand(name: string, def: { handler: Function }): void {
      commands.set(name, def);
    },
  } as unknown as ExtensionAPI;

  registerActivitySummary(pi);

  return {
    handlers,
    commands,
    widgets,
    ctx,
    emit(event: string, data?: unknown): void {
      handlers.get(event)?.(data as never, ctx);
    },
  };
}

function msgEntry(message: AgentMessage, id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-11-26T00:00:00Z",
    message,
  };
}

function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: 0 } as AgentMessage;
}

function assistant(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: 0,
  } as AgentMessage;
}

describe("activity-summary wiring", () => {
  test("renders widget from branch messages on session_start", () => {
    const h = harness([msgEntry(user("Làm widget"), "m1")]);
    h.emit("session_start", { type: "session_start", reason: "startup" });
    const lines = h.widgets.get(WIDGET_ID);
    expect(lines).toBeDefined();
    expect(lines!.join("\n")).toContain("• Làm widget");
  });

  test("hides widget when branch has no messages", () => {
    const h = harness([]);
    h.emit("session_start", { type: "session_start", reason: "startup" });
    expect(h.widgets.get(WIDGET_ID)).toBeUndefined();
  });

  test("updates widget on message_end", () => {
    const h = harness([]);
    h.emit("session_start", { type: "session_start", reason: "startup" });
    h.emit("message_end", {
      type: "message_end",
      message: user("Đọc code và tóm tắt"),
    });
    h.emit("message_end", {
      type: "message_end",
      message: assistant("Đã đọc.\nTiếp theo: viết summary"),
    });
    const text = h.widgets.get(WIDGET_ID)!.join("\n");
    expect(text).toContain("Đọc code và tóm tắt");
    expect(text).toContain("Tiếp theo: viết summary");
  });

  test("session_tree rebuilds from the new branch", () => {
    const forked = harness([msgEntry(user("Nhánh A"), "m1")]);
    forked.emit("session_start", { type: "session_start", reason: "fork" });
    const textA = forked.widgets.get(WIDGET_ID)!.join("\n");
    expect(textA).toContain("Nhánh A");

    // Simulate branch switch: same harness sees different branch entries
    const other = harness([msgEntry(user("Nhánh B"), "m2")]);
    other.emit("session_tree", { type: "session_tree" });
    const textB = other.widgets.get(WIDGET_ID)!.join("\n");
    expect(textB).toContain("Nhánh B");
    expect(textB).not.toContain("Nhánh A");
  });

  test("/activity toggles the widget off and on", async () => {
    const h = harness([msgEntry(user("Chủ đề"), "m1")]);
    h.emit("session_start", { type: "session_start", reason: "startup" });
    expect(h.widgets.get(WIDGET_ID)).toBeDefined();

    await h.commands.get("activity")!.handler("", h.ctx);
    expect(h.widgets.get(WIDGET_ID)).toBeUndefined();

    await h.commands.get("activity")!.handler("", h.ctx);
    expect(h.widgets.get(WIDGET_ID)).toBeDefined();
  });

  test("/activity on|off sets state explicitly", async () => {
    const h = harness([msgEntry(user("Chủ đề"), "m1")]);
    h.emit("session_start", { type: "session_start", reason: "startup" });

    await h.commands.get("activity")!.handler("off", h.ctx);
    expect(h.widgets.get(WIDGET_ID)).toBeUndefined();

    // off again stays off (no toggle confusion)
    await h.commands.get("activity")!.handler("off", h.ctx);
    expect(h.widgets.get(WIDGET_ID)).toBeUndefined();

    await h.commands.get("activity")!.handler("on", h.ctx);
    expect(h.widgets.get(WIDGET_ID)).toBeDefined();
  });

  test("session_shutdown clears the widget", () => {
    const h = harness([msgEntry(user("Chủ đề"), "m1")]);
    h.emit("session_start", { type: "session_start", reason: "startup" });
    h.emit("session_shutdown", { type: "session_shutdown" });
    expect(h.widgets.get(WIDGET_ID)).toBeUndefined();
  });
});
