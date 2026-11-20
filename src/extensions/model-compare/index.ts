import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
  AssistantMessage,
  Context,
  Model,
  Api,
} from "@earendil-works/pi-ai";
import { ModelResolver } from "../../shared/ModelResolver";
import { Renderer } from "../../shared/Renderer";
import { Tools } from "../../shared/Tools";
import {
  type CompareDetails,
  type CompareEntry,
  type CompareInput,
  compareSchema,
} from "./schema";

const MAX_MODELS = 4;
const MIN_MODELS = 2;
const PER_MODEL_TIMEOUT_MS = 120_000;
const OUTPUT_CAP = 12_000;

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

async function compareOne(
  ref: string,
  model: Model<Api>,
  context: Context,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext
): Promise<CompareEntry> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_MODEL_TIMEOUT_MS);
  timer.unref?.();
  const onParent = () => ctrl.abort();
  signal?.addEventListener("abort", onParent, { once: true });

  const started = Date.now();
  try {
    const message = await ctx.modelRegistry
      .streamSimple(model, context, { signal: ctrl.signal })
      .result();
    const text = extractText(message);
    return {
      ref,
      model: `${model.provider}/${model.id}`,
      ok: message.stopReason !== "error" && text.length > 0,
      text: text.slice(0, OUTPUT_CAP),
      error:
        message.stopReason === "error"
          ? (message.errorMessage ?? "provider error")
          : text.length === 0
            ? "empty response"
            : null,
      durationMs: Date.now() - started,
      cost: message.usage?.cost?.total ?? 0,
      outputTokens: message.usage?.output ?? 0,
    };
  } catch (err) {
    return {
      ref,
      model: `${model.provider}/${model.id}`,
      ok: false,
      text: "",
      error:
        ctrl.signal.aborted && !signal?.aborted
          ? `timed out after ${PER_MODEL_TIMEOUT_MS / 1000}s`
          : err instanceof Error
            ? err.message
            : String(err),
      durationMs: Date.now() - started,
      cost: 0,
      outputTokens: 0,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onParent);
  }
}

function format(entries: readonly CompareEntry[]): string {
  const parts: string[] = [];
  for (const e of entries) {
    parts.push(
      `=== ${e.model} ${e.ok ? "" : "(failed) "}` +
        `[$${e.cost.toFixed(4)}, ${e.outputTokens} tok, ${(e.durationMs / 1000).toFixed(1)}s] ===`
    );
    parts.push(e.ok ? e.text || "(empty)" : `ERROR: ${e.error}`);
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

export default function (pi: ExtensionAPI): void {
  Tools.register<typeof compareSchema, CompareDetails>(pi, {
    name: "compare_models",
    label: "compare models",
    description:
      "Send the same prompt to 2–4 models in parallel and show their answers side by side. " +
      "Models are text-only — no tools, no side effects. Use to compare quality, style, latency, or cost across models. " +
      "Each model gets 120s; failures are reported per model without cancelling the others.",
    parameters: compareSchema,
    renderShell: "self",
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx: ExtensionContext) {
      const input = params as CompareInput;
      const refs = (input.models ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (refs.length < MIN_MODELS || refs.length > MAX_MODELS) {
        throw new Error(
          `compare_models needs ${MIN_MODELS}–${MAX_MODELS} comma-separated model references, got ${refs.length}`
        );
      }

      const context: Context = {
        ...(input.system ? { systemPrompt: input.system } : {}),
        messages: [
          { role: "user", content: input.prompt, timestamp: Date.now() },
        ],
      };

      const entries = await Promise.all(
        refs.map(async (ref): Promise<CompareEntry> => {
          const candidates = await ModelResolver.resolveCandidates(
            ctx.modelRegistry,
            ref,
            ctx.model?.provider
          );
          const model = candidates[0];
          if (!model) {
            return {
              ref,
              model: ref,
              ok: false,
              text: "",
              error: `unknown model or no configured auth: ${ref}`,
              durationMs: 0,
              cost: 0,
              outputTokens: 0,
            };
          }
          return compareOne(ref, model, context, signal, ctx);
        })
      );

      const okCount = entries.filter((e) => e.ok).length;
      const text = format(entries);
      return {
        content: [
          {
            type: "text" as const,
            text: `${okCount}/${entries.length} models answered.\n\n` + text,
          },
        ],
        details: { entries },
      } satisfies AgentToolResult<CompareDetails>;
    },
    renderCall(args, theme, context) {
      const input = args as Partial<CompareInput> | undefined;
      const models =
        typeof input?.models === "string" ? input.models : "(current)";
      return Renderer.renderStatefulToolCallTitle({
        label: "compare",
        title: models.slice(0, 100),
        theme,
        context,
      });
    },
    renderResult(result, options, theme, context) {
      return Renderer.renderBorderedResult({
        result,
        options,
        theme,
        context,
        previewLines: 20,
        prefix: { prefix: "   ", width: 3 },
      });
    },
  });
}
