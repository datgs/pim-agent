import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Jobs, type Job } from "../../shared/Jobs";
import { Paths } from "../../shared/Paths";
import {
  Renderer,
  type StatefulToolCallTitleContext,
} from "../../shared/Renderer";
import { SpillCache } from "../../shared/SpillCache";
import { Tools } from "../../shared/Tools";
import { detailsOf, formatResult, isErrorResult } from "./format";
import { killAllActiveBashGroups, runBashCommand } from "./run";
import {
  type BashInput,
  bashSchema,
  DEFAULT_TIMEOUT_MS,
  type JobsInput,
  jobsSchema,
} from "./schema";

const PREVIEW_LINES = 5;
const TITLE_MAX_LINES = 7;

type BashRenderContext = StatefulToolCallTitleContext & {
  readonly args?: Partial<BashInput>;
  readonly cwd: string;
};

function renderTitle(
  args: Partial<BashInput> | undefined,
  theme: Parameters<typeof Renderer.renderStatefulToolCallTitle>[0]["theme"],
  context: BashRenderContext
) {
  const command =
    typeof args?.command === "string" && args.command ? args.command : "...";
  const title = `${command}${Paths.cwdSuffix(args?.cwd, context.cwd)}`;
  return Renderer.renderStatefulToolCallTitle({
    label: "",
    title,
    theme,
    context,
    markerGlyph: "$",
    separator: "",
    pad: false,
    useSpinner: true,
    maxLines: TITLE_MAX_LINES,
  });
}

function previewResult(
  result: AgentToolResult<unknown>,
  isError: boolean
): AgentToolResult<unknown> {
  if (isError) {
    return result;
  }

  const first = result.content?.[0];
  if (!first || !("text" in first)) {
    return result;
  }

  const lines = (first.text ?? "").split("\n");
  if (lines[0] === "Exit code: 0") {
    lines.shift();
  }
  if (lines[0] === "stdout:" || lines[0] === "stderr:") {
    lines.shift();
  }

  return {
    ...result,
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

let lifecycleHandlersInstalled = false;

function installLifecycleHandlers(): void {
  if (lifecycleHandlersInstalled) {
    return;
  }
  lifecycleHandlersInstalled = true;

  // Sweep bash subtrees that escaped our process group (double-forked
  // daemons in their own session) or that the parent harness is about to
  // strand by signalling us. Re-raise the signal so the default handler
  // still runs.
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.once(sig, () => {
      try {
        killAllActiveBashGroups(sig);
      } catch {}
      process.kill(process.pid, sig);
    });
  }
}

/**
 * Build the environment for a bash subprocess, injecting fresh Pi session
 * metadata (PI_SESSION_ID, PI_PROVIDER, PI_MODEL, …) so user scripts and
 * CLI tools can adapt to the active session/model. Stale values inherited
 * from process.env are cleaned first.
 */
function buildBashEnv(ctx: ExtensionContext): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Clean any stale PI_* values inherited from the parent process.
  delete env.PI_SESSION_ID;
  delete env.PI_SESSION_FILE;
  delete env.PI_PROVIDER;
  delete env.PI_MODEL;
  delete env.PI_REASONING_LEVEL;

  env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (sessionFile) {
    env.PI_SESSION_FILE = sessionFile;
  }
  if (ctx.model) {
    env.PI_PROVIDER = ctx.model.provider;
    env.PI_MODEL = ctx.model.id;
  }
  if (ctx.thinkingLevel) {
    env.PI_REASONING_LEVEL = ctx.thinkingLevel;
  }
  return env;
}

export default function (pi: ExtensionAPI): void {
  SpillCache.installSweeper();
  installLifecycleHandlers();
  Tools.register(pi, {
    name: "bash",
    label: "bash",
    description:
      "Execute a bash command in the cwd. " +
      "Returns exit code, signal (if any), and stdout/stderr captured separately. " +
      "Prefer commands that emit only what you need; keep output as small as possible. " +
      "Pass `cwd` (an absolute path) to run in another directory instead of prefixing the command with `cd … &&`.",
    parameters: bashSchema,
    renderShell: "self",
    executionMode: "sequential",
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    async execute(_id, params, signal, _onUpdate, ctx) {
      const {
        command,
        cwd,
        timeoutMs: requestedTimeoutMs,
      } = params as BashInput;
      const timeoutMs = requestedTimeoutMs ?? DEFAULT_TIMEOUT_MS;
      const effectiveCwd = cwd ? Paths.requireAbsolute(cwd) : ctx.cwd;

      if (signal?.aborted) {
        throw new Error("Command aborted before execution.");
      }

      const outcome = await runBashCommand(
        command,
        timeoutMs,
        signal,
        effectiveCwd,
        buildBashEnv(ctx)
      );

      if ("backgrounded" in outcome) {
        const job = Jobs.create({
          kind: "bash",
          title: command,
          onCancel: outcome.kill,
        });
        void outcome.done.then((result) => {
          const status =
            result.aborted || result.exitCode !== 0 ? "failed" : "completed";
          Jobs.setStatus(job.id, status, {
            exitCode: result.exitCode,
            output: {
              stdout: {
                totalBytes: result.stdout.totalBytes,
                path: result.stdout.path,
              },
              stderr: {
                totalBytes: result.stderr.totalBytes,
                path: result.stderr.path,
              },
            },
          });
          // Transcript-only notice: the agent already holds jobId and polls
          // via the jobs tool; no extra turn is triggered.
          try {
            pi.sendMessage({
              customType: "bash-job",
              content: `Background job ${job.id} ${status} (exit ${result.exitCode ?? "none"}): ${command.slice(0, 200)}`,
              display: false,
              details: { jobId: job.id, status, exitCode: result.exitCode },
            });
          } catch {}
        });
        return {
          content: [
            {
              type: "text",
              text:
                `Timed out after ${timeoutMs} ms; command kept running as background job ${job.id}. ` +
                `Use the jobs tool (action: status/output/kill, id: "${job.id}") to check it.`,
            },
          ],
          details: {
            exitCode: null,
            signal: null,
            durationMs: timeoutMs,
            timedOut: true,
            aborted: false,
            jobId: job.id,
            stdout: {
              totalBytes: outcome.stdout.totalBytes,
              truncated: false,
              path: null,
            },
            stderr: {
              totalBytes: outcome.stderr.totalBytes,
              truncated: false,
              path: null,
            },
          },
        };
      }

      const result = outcome;
      const text = formatResult(result, timeoutMs);
      if (isErrorResult(result)) {
        throw new Error(text);
      }
      return {
        content: [{ type: "text", text }],
        details: detailsOf(result),
      };
    },
    renderCall(args, theme, context) {
      return renderTitle(
        args as Partial<BashInput> | undefined,
        theme,
        context
      );
    },
    renderResult(result, options, theme, context) {
      renderTitle(context.args, theme, context);
      return Renderer.renderBorderedResult({
        result: previewResult(result, context.isError),
        options,
        theme,
        context,
        previewLines: PREVIEW_LINES,
        prefix: { prefix: "   ", width: 3 },
        showCollapsedSuccess: true,
        previewFromEnd: true,
      });
    },
  });

  Tools.register<typeof jobsSchema, { jobs: readonly Job[] }>(pi, {
    name: "jobs",
    label: "jobs",
    description:
      "Inspect and manage background jobs (bash commands that outlived their timeout, background subagents). " +
      "list: all jobs newest first. status/output/kill take an id (e.g. bash-1). " +
      "Jobs live only while this process runs; they are killed at shutdown.",
    parameters: jobsSchema,
    renderShell: "self",
    executionMode: "parallel",
    async execute(_id, params) {
      const input = params as JobsInput;
      switch (input.action) {
        case "list": {
          const jobs = Jobs.list();
          if (jobs.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No background jobs." }],
              details: { jobs },
            };
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(jobs, null, 2) },
            ],
            details: { jobs },
          };
        }
        case "status": {
          const job = requireJob(input.id);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(job, null, 2) },
            ],
            details: { jobs: [job] },
          };
        }
        case "output": {
          const job = requireJob(input.id);
          const parts: string[] = [
            `${job.id} ${job.status}${job.exitCode !== null ? ` exit=${job.exitCode}` : ""}`,
          ];
          if (job.output.stdout) {
            parts.push(
              `stdout: ${job.output.stdout.totalBytes} bytes${job.output.stdout.path ? ` (spilled: ${job.output.stdout.path})` : ""}`
            );
          }
          if (job.output.stderr) {
            parts.push(
              `stderr: ${job.output.stderr.totalBytes} bytes${job.output.stderr.path ? ` (spilled: ${job.output.stderr.path})` : ""}`
            );
          }
          if (job.output.text) {
            parts.push(job.output.text);
          }
          if (parts.length === 1) {
            parts.push(
              job.status === "running"
                ? "Still running; final output is attached when it exits."
                : "No output recorded."
            );
          }
          return {
            content: [{ type: "text" as const, text: parts.join("\n") }],
            details: { jobs: [job] },
          };
        }
        case "kill": {
          const id = input.id;
          if (!id) {
            throw new Error('"id" is required for action=kill');
          }
          if (!Jobs.cancel(id)) {
            const job = Jobs.get(id);
            throw new Error(
              job
                ? `job ${id} is ${job.status}; only running jobs can be killed`
                : `no job with id ${id}`
            );
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `Kill requested for ${id} (SIGTERM, SIGKILL after grace).`,
              },
            ],
            details: { jobs: [Jobs.get(id)!] },
          };
        }
      }
    },
    renderCall(args, theme, context) {
      const input = args as Partial<JobsInput> | undefined;
      return Renderer.renderStatefulToolCallTitle({
        label: "jobs",
        title: `${input?.action ?? "list"}${input?.id ? ` ${input.id}` : ""}`,
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
        previewLines: PREVIEW_LINES,
        prefix: { prefix: "   ", width: 3 },
      });
    },
  });
}

function requireJob(id: string | null | undefined): Job {
  if (!id) {
    throw new Error('"id" is required for this action');
  }
  const job = Jobs.get(id);
  if (!job) {
    throw new Error(`no job with id ${id}`);
  }
  return job;
}
