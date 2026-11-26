import { afterEach, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { ActivityButton } from "../../shared/ActivityButton";
import registerActivitySummary from "./index";

afterEach(() => {
  ActivityButton.resetForTests();
});

type Handler = (event: never, ctx: ExtensionContext) => void;

type Harness = {
  readonly handlers: Map<string, Handler>;
  readonly commands: Map<string, { handler: Function }>;
  readonly ctx: ExtensionContext;
  emit(event: string, data?: unknown): void;
};

function harness(branch: readonly SessionEntry[] = []): Harness {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: Function }>();

  const ctx = {
    cwd: "/work",
    hasUI: true,
    ui: {
      theme: { fg: (_c: string, t: string) => t },
      setWidget: (): void => {},
      notify: (): void => {},
      custom: (): Promise<undefined> => Promise.resolve(undefined),
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

describe("activity-summary wiring", () => {
  test("shows the button when branch messages produce a summary", () => {
    const h = harness([msgEntry(user("Làm widget"), "m1")]);
    h.emit("session_start", { type: "session_start", reason: "startup" });
    expect(ActivityButton.isShown()).toBe(true);
  });

  test("hides the button when branch has no messages", () => {
    const h = harness([]);
    h.emit("session_start", { type: "session_start", reason: "startup" });
    expect(ActivityButton.isShown()).toBe(false);
  });

  test("shows the button on message_end", () => {
    const h = harness([]);
    h.emit("session_start", { type: "session_start", reason: "startup" });
    expect(ActivityButton.isShown()).toBe(false);
    h.emit("message_end", {
      type: "message_end",
      message: user("Đọc code và tóm tắt"),
    });
    expect(ActivityButton.isShown()).toBe(true);
  });

  test("session_tree hides the button on a branch without content", () => {
    const h = harness([msgEntry(user("Nhánh A"), "m1")]);
    h.emit("session_start", { type: "session_start", reason: "fork" });
    expect(ActivityButton.isShown()).toBe(true);

    const other = harness([]);
    other.emit("session_tree", { type: "session_tree" });
    expect(ActivityButton.isShown()).toBe(false);
  });

  test("/activity toggles the button off and on", async () => {
    const h = harness([msgEntry(user("Chủ đề"), "m1")]);
    h.emit("session_start", { type: "session_start", reason: "startup" });
    expect(ActivityButton.isShown()).toBe(true);

    await h.commands.get("activity")!.handler("", h.ctx);
    expect(ActivityButton.isShown()).toBe(false);

    await h.commands.get("activity")!.handler("", h.ctx);
    expect(ActivityButton.isShown()).toBe(true);
  });

  test("/activity on|off sets state explicitly", async () => {
    const h = harness([msgEntry(user("Chủ đề"), "m1")]);
    h.emit("session_start", { type: "session_start", reason: "startup" });

    await h.commands.get("activity")!.handler("off", h.ctx);
    expect(ActivityButton.isShown()).toBe(false);

    await h.commands.get("activity")!.handler("off", h.ctx);
    expect(ActivityButton.isShown()).toBe(false);

    await h.commands.get("activity")!.handler("on", h.ctx);
    expect(ActivityButton.isShown()).toBe(true);
  });

  test("session_shutdown hides the button", () => {
    const h = harness([msgEntry(user("Chủ đề"), "m1")]);
    h.emit("session_start", { type: "session_start", reason: "startup" });
    h.emit("session_shutdown", { type: "session_shutdown" });
    expect(ActivityButton.isShown()).toBe(false);
  });
});
