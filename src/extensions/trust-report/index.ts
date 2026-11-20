import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { discoverConfig, type TrustReport } from "./discover";

const WIDGET_ID = "trust-report";
const MAX_LISTED = 12;

function formatReport(report: TrustReport): string[] {
  const lines: string[] = [];

  if (report.entries.length === 0) {
    lines.push("No configuration resources found.");
  }

  const project = report.entries.filter((e) => e.scope === "project");
  const user = report.entries.filter((e) => e.scope === "user");

  if (project.length > 0) {
    lines.push("Project resources (load only when project trust is granted):");
    for (const e of project.slice(0, MAX_LISTED)) {
      lines.push(`  ${e.path}`);
      lines.push(`    ${e.category}`);
      for (const d of e.details) {
        lines.push(`    ${d}`);
      }
    }
    if (project.length > MAX_LISTED) {
      lines.push(`  … ${project.length - MAX_LISTED} more`);
    }
    lines.push("");
  }

  if (user.length > 0) {
    lines.push("User-level resources:");
    for (const e of user) {
      lines.push(`  ${e.path}`);
      lines.push(`    ${e.category}`);
      for (const d of e.details) {
        lines.push(`    ${d}`);
      }
    }
    lines.push("");
  }

  if (report.trustDecisions.length > 0) {
    lines.push("Saved trust decisions covering this directory:");
    for (const d of report.trustDecisions) {
      lines.push(`  ${d}`);
    }
  } else {
    lines.push("No saved trust decision covers this directory.");
  }

  return lines;
}

export default function (pi: ExtensionAPI): void {
  let widgetShown = false;
  let startupNoticeShown = false;

  pi.registerCommand("trust-report", {
    description:
      "List every project/user config source (settings, MCP, extensions, skills, context files) and what it declares",
    handler: async (_args, ctx) => {
      let report: TrustReport;
      try {
        report = await discoverConfig(ctx.cwd);
      } catch (err) {
        ctx.ui.notify(`trust scan failed: ${(err as Error).message}`, "error");
        return;
      }
      const lines = [
        "Config sources affecting this session",
        "",
        ...formatReport(report),
      ];
      if (!ctx.hasUI) {
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }
      ctx.ui.setWidget(WIDGET_ID, () => new Text(lines.join("\n"), 0, 0));
      widgetShown = true;
    },
  });

  // Clear the report when the user starts typing again.
  pi.on("input", (_event, ctx) => {
    if (widgetShown) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      widgetShown = false;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    if (startupNoticeShown || !ctx.hasUI) {
      return;
    }
    // One advisory notice per process: surface that this directory ships
    // executable/model-steering resources and where they were found. It does
    // not block anything — pi's own trust prompt remains the gate.
    try {
      const report = await discoverConfig(ctx.cwd);
      const n = report.executableProjectEntries.length;
      if (n === 0) {
        return;
      }
      startupNoticeShown = true;
      ctx.ui.notify(
        `This project declares ${n} executable config resource${n === 1 ? "" : "s"} ` +
          `(settings/extensions/skills/MCP/context files). ` +
          `Review origins with /trust-report.`,
        "warning"
      );
    } catch {
      // Trust reporting must never break session startup.
    }
  });
}
