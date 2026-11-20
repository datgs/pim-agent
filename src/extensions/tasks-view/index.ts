import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Jobs, type Job } from "../../shared/Jobs";

const WIDGET_ID = "tasks-view";

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatJob(job: Job, now: number): string {
  const end = job.endedAt ?? now;
  const status =
    job.status === "running"
      ? job.status
      : `${job.status}${job.exitCode !== null ? ` (exit ${job.exitCode})` : ""}`;
  const dur = formatDuration(Math.max(0, end - job.createdAt));
  return `  ${job.id}  ${status}  ${dur}  ${job.title}`;
}

export default function (pi: ExtensionAPI): void {
  let widgetShown = false;

  pi.registerCommand("tasks", {
    description:
      "Show background activity: running/finished bash jobs and background subagents in this process",
    handler: async (_args, ctx) => {
      const jobs = Jobs.list();
      const now = Date.now();
      const running = jobs.filter((j) => j.status === "running");
      const settled = jobs.filter((j) => j.status !== "running");

      const lines: string[] = [
        "Background activity (process-local; dies with this session)",
        "",
      ];
      if (jobs.length === 0) {
        lines.push("No background jobs.");
      } else {
        if (running.length > 0) {
          lines.push(`Running (${running.length}):`);
          lines.push(...running.map((j) => formatJob(j, now)));
        }
        if (settled.length > 0) {
          if (running.length > 0) {
            lines.push("");
          }
          lines.push(`Finished (${settled.length}):`);
          lines.push(...settled.slice(0, 10).map((j) => formatJob(j, now)));
          if (settled.length > 10) {
            lines.push(`  … ${settled.length - 10} more (jobs list for all)`);
          }
        }
      }

      if (!ctx.hasUI) {
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }
      ctx.ui.setWidget(WIDGET_ID, () => new Text(lines.join("\n"), 0, 0));
      widgetShown = true;
    },
  });

  pi.on("input", (_event, ctx) => {
    if (widgetShown) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      widgetShown = false;
    }
  });
}
