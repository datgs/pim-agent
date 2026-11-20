import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import registerCompare from "./index";

function assistantMessage(text: string, output = 10): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "proxy",
    model: "x",
    usage: {
      input: 5,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function capture(): {
  tool(): { execute: Function };
  streams: { model: string; context: unknown }[];
} {
  const streams: { model: string; context: unknown }[] = [];
  let tool: { execute: Function } | undefined;
  const pi = {
    registerTool(def: unknown): void {
      tool = def as typeof tool;
    },
    on(): void {},
  } as unknown as ExtensionAPI;
  registerCompare(pi);
  return {
    tool() {
      if (!tool) {
        throw new Error("tool not registered");
      }
      return tool;
    },
    streams,
  };
}

function makeCtx(
  models: { provider: string; id: string }[],
  streams: { model: string; context: unknown }[],
  impl?: (model: { provider: string; id: string }) => Promise<AssistantMessage>
): ExtensionContext {
  return {
    cwd: "/work",
    model: { provider: "proxy", id: "current" },
    modelRegistry: {
      getAll: () => models.map((m) => ({ ...m }) as never),
      hasConfiguredAuth: () => true,
      streamSimple: (
        model: { provider: string; id: string },
        context: unknown
      ) => {
        streams.push({ model: model.id, context });
        return {
          result: () =>
            impl
              ? impl(model)
              : Promise.resolve(assistantMessage(`answer from ${model.id}`)),
        };
      },
    },
  } as unknown as ExtensionContext;
}

describe("compare_models", () => {
  test("fans out to resolved models and formats side-by-side", async () => {
    const { tool, streams } = capture();
    const ctx = makeCtx(
      [
        { provider: "proxy", id: "a" },
        { provider: "proxy", id: "b" },
      ],
      streams
    );
    const result = (await tool().execute(
      "c1",
      { prompt: "hello", models: "a, b" },
      undefined,
      undefined,
      ctx
    )) as { content: { text: string }[] };

    expect(streams.map((s) => s.model).sort()).toEqual(["a", "b"]);
    expect(result.content[0]!.text).toContain("2/2 models answered");
    expect(result.content[0]!.text).toContain("proxy/a");
    expect(result.content[0]!.text).toContain("proxy/b");
    expect(result.content[0]!.text).toContain("answer from a");
  });

  test("rejects fewer than 2 or more than 4 models", async () => {
    const { tool, streams } = capture();
    const ctx = makeCtx([], streams);
    await expect(
      tool().execute(
        "c1",
        { prompt: "x", models: "solo" },
        undefined,
        undefined,
        ctx
      )
    ).rejects.toThrow("needs 2–4");
    await expect(
      tool().execute(
        "c1",
        { prompt: "x", models: "a,b,c,d,e" },
        undefined,
        undefined,
        ctx
      )
    ).rejects.toThrow("needs 2–4");
  });

  test("per-model failure does not cancel peers", async () => {
    const { tool, streams } = capture();
    const ctx = makeCtx(
      [
        { provider: "proxy", id: "good" },
        { provider: "proxy", id: "bad" },
      ],
      streams,
      async (model) => {
        if (model.id === "bad") {
          throw new Error("provider down");
        }
        return assistantMessage("fine answer");
      }
    );
    const result = (await tool().execute(
      "c1",
      { prompt: "x", models: "good, bad" },
      undefined,
      undefined,
      ctx
    )) as { content: { text: string }[] };
    const text = result.content[0]!.text;
    expect(text).toContain("1/2 models answered");
    expect(text).toContain("fine answer");
    expect(text).toContain("provider down");
    expect(text).toContain("(failed)");
  });

  test("unknown model reference reports error entry", async () => {
    const { tool, streams } = capture();
    const ctx = makeCtx([{ provider: "proxy", id: "a" }], streams);
    const result = (await tool().execute(
      "c1",
      { prompt: "x", models: "a, ghost-model" },
      undefined,
      undefined,
      ctx
    )) as {
      content: { text: string }[];
      details: { entries: { ok: boolean; error: string | null }[] };
    };
    const bad = result.details.entries.find((e) => !e.ok);
    expect(bad?.error).toContain("ghost-model");
  });
});
