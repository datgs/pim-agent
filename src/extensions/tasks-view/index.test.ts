import { afterEach, describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Jobs } from "../../shared/Jobs";
import registerTasksView from "./index";

afterEach(() => {
  Jobs.resetForTests();
});

function capture(): {
  readonly notify: { text: string; level: string }[];
  readonly commands: Map<string, { handler: Function }>;
} {
  const notify: { text: string; level: string }[] = [];
  const commands = new Map<string, { handler: Function }>();
  const pi = {
    on(): void {},
    registerCommand(name: string, def: { handler: Function }): void {
      commands.set(name, def);
    },
  } as unknown as ExtensionAPI;
  registerTasksView(pi);
  return { notify, commands };
}

const ctx = {
  cwd: "/work",
  hasUI: false,
  ui: {
    notify: (text: string, level: string): void => {
      capturedNotify.push({ text, level });
    },
    setWidget(): void {},
  },
} as unknown as ExtensionContext;

const capturedNotify: { text: string; level: string }[] = [];

describe("/tasks view", () => {
  test("reports empty state", async () => {
    const { commands } = capture();
    await commands.get("tasks")!.handler("", ctx);
    expect(capturedNotify.at(-1)?.text).toContain("No background jobs");
  });

  test("lists running and finished jobs with status and duration", async () => {
    const running = Jobs.create({ kind: "bash", title: "npm run build" });
    const done = Jobs.create({ kind: "subagent", title: "research task" });
    Jobs.setStatus(done.id, "completed", { exitCode: 0 });

    const { commands } = capture();
    await commands.get("tasks")!.handler("", ctx);
    const text = capturedNotify.at(-1)!.text;
    expect(text).toContain(running.id);
    expect(text).toContain("Running (1)");
    expect(text).toContain("Finished (1)");
    expect(text).toContain(done.id);
    expect(text).toContain("completed (exit 0)");
    expect(text).toContain("process-local");
  });
});
