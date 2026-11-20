import { type Static, Type } from "typebox";

export type ScheduleSpec =
  | { readonly type: "once"; readonly at: string }
  | { readonly type: "interval"; readonly every: string }
  | { readonly type: "cron"; readonly expr: string }
  | {
      readonly type: "watch";
      readonly command: string;
      readonly every: string;
    };

export type ScheduledTask = {
  readonly id: string;
  readonly prompt: string;
  readonly chatId: number;
  readonly threadId: number | undefined;
  readonly schedule: ScheduleSpec;
  readonly status: "active" | "paused";
  readonly nextRun: string;
  readonly expires: string | null;
  readonly isolatedSession: boolean;
  readonly createdAt: string;
  // Watch-trigger state: fingerprint of the last observed probe output.
  // Absent until the baseline run establishes it; the baseline never fires.
  readonly lastFingerprint?: string;
};

const scheduleSchema = Type.Union([
  Type.Object({
    type: Type.Literal("once"),
    at: Type.String({
      description:
        "RFC3339 timestamp in the future, UTC. Example: '2026-05-14T15:30:00Z'.",
    }),
  }),
  Type.Object({
    type: Type.Literal("interval"),
    every: Type.String({
      description:
        "Duration like '30m', '2h', '1h30m'. Units: s, m, h, d. Minimum 1 minute.",
    }),
  }),
  Type.Object({
    type: Type.Literal("cron"),
    expr: Type.String({
      description:
        "Standard 5-field cron expression in UTC. Macros @hourly, @daily, @weekly, @monthly, @yearly supported.",
    }),
  }),
  Type.Object({
    type: Type.Literal("watch"),
    command: Type.String({
      description:
        "Probe command run every interval (e.g. 'git ls-remote origin HEAD', 'curl -s https://status.example.com'). " +
        "The task fires when its output changes from the previous observation. The first run only records a baseline and does not fire.",
      minLength: 1,
    }),
    every: Type.String({
      description: "Poll interval like '30m', '2h', '1h30m'. Minimum 1 minute.",
    }),
  }),
]);

export const taskToolSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("create"),
      Type.Literal("list"),
      Type.Literal("delete"),
      Type.Literal("pause"),
      Type.Literal("resume"),
      Type.Literal("update_prompt"),
    ],
    {
      description:
        "create: schedule a new task. list: see this thread's tasks. delete/pause/resume: by id. update_prompt: change a task's prompt. " +
        "Schedule types: once at a timestamp, interval, cron — or 'watch': poll a probe command every interval and fire when its output changes.",
    }
  ),
  prompt: Type.Optional(
    Type.String({
      description:
        "Required for 'create' and 'update_prompt'. The instruction the agent will receive when the task fires.",
      minLength: 1,
    })
  ),
  schedule: Type.Optional(scheduleSchema),
  expires: Type.Optional(
    Type.String({
      description:
        "Optional RFC3339 timestamp after which the task auto-deletes without firing again.",
    })
  ),
  isolatedSession: Type.Optional(
    Type.Boolean({
      description:
        "If true, run in a fresh/isolated session with no chat history. Default false.",
    })
  ),
  id: Type.Optional(
    Type.String({
      description:
        "Task id. Required for delete, pause, resume, update_prompt.",
    })
  ),
});

export type TaskToolInput = Static<typeof taskToolSchema>;
