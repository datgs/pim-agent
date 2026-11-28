import type { AgentMessage } from "@earendil-works/pi-agent-core";

export type ActivitySummary = {
  readonly bullets: readonly string[];
};

const PLAN_HEADING = /^plan:\s*$/im;
const NUMBERED_STEP = /^\s*(?:\d+[.)]|[-•*])\s+(.+)$/;
const NEXT_STEP_PATTERN =
  /(?:^|\n)\s*(?:[-•*]\s*)?(tiếp theo|next|then i(?:'|’)ll|i will now|bước tiếp)[:\s]+([^\n]+)/im;
const DONE_MARKER = /\[DONE:?(\d+)?\]/i;

const MAX_BULLETS = 3;
const MAX_TEXT = 200;

const VIETNAMESE_MARKERS =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

function nextPrefix(sample: string): string {
  return VIETNAMESE_MARKERS.test(sample) ? "Tiếp theo" : "Next";
}

function truncate(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_TEXT) {
    return clean;
  }
  return `${clean.slice(0, MAX_TEXT - 1)}…`;
}

const MAX_LINES = 8;

function truncateMultiline(text: string): string {
  const lines = text.split("\n").map((l) => l.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }
  const clipped = lines.slice(0, MAX_LINES);
  let result = clipped.join("\n");
  if (lines.length > MAX_LINES) {
    result += `\n… (${lines.length - MAX_LINES} more lines)`;
  }
  if (result.length > MAX_TEXT * 3) {
    result = `${result.slice(0, MAX_TEXT * 3 - 1)}…`;
  }
  result = result.trim();
  return result.includes("\n") ? result : truncate(result);
}

function textOf(message: AgentMessage): string {
  if (message.role !== "assistant") {
    return "";
  }
  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function userTextOf(message: AgentMessage): string {
  if (message.role !== "user") {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

type PlanState = {
  readonly items: readonly string[];
  readonly doneCount: number;
};

function extractPlan(messages: readonly AgentMessage[]): PlanState | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") {
      continue;
    }
    const text = textOf(msg);
    const match = PLAN_HEADING.exec(text);
    if (!match) {
      continue;
    }
    const section = text.slice(match.index + (match[0] ?? "").length);
    const items: string[] = [];
    let doneCount = 0;
    for (const line of section.split("\n")) {
      const step = NUMBERED_STEP.exec(line);
      if (!step) {
        if (items.length > 0) {
          break;
        }
        continue;
      }
      let item = (step[1] ?? "").trim();
      if (DONE_MARKER.test(item)) {
        doneCount++;
        item = item.replace(DONE_MARKER, "").trim();
      }
      if (item) {
        items.push(item);
      }
      if (items.length >= 6) {
        break;
      }
    }
    if (items.length > 0) {
      return { items, doneCount };
    }
  }
  return null;
}

function extractNext(text: string): string | null {
  const m = NEXT_STEP_PATTERN.exec(text);
  if (!m) {
    return null;
  }
  const step = (m[2] ?? "").replace(/[.\s]+$/, "").trim();
  return step ? truncate(step) : null;
}

function extractTopic(userText: string): string {
  return truncateMultiline(userText);
}

export function buildActivitySummary(
  messages: readonly AgentMessage[]
): ActivitySummary | null {
  const plan = extractPlan(messages);
  if (plan) {
    const bullets: string[] = [];
    const remaining = plan.items.slice(plan.doneCount);
    const current = remaining[0];
    if (current) {
      bullets.push(truncate(current));
    }
    const next = remaining[1];
    if (next) {
      bullets.push(`${nextPrefix(plan.items.join(" "))}: ${truncate(next)}`);
    }
    return bullets.length > 0 ? { bullets } : null;
  }

  let latestAssistant = "";
  let latestUser = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) {
      continue;
    }
    if (!latestAssistant && msg.role === "assistant") {
      latestAssistant = textOf(msg);
    } else if (!latestUser && msg.role === "user") {
      latestUser = userTextOf(msg);
    }
    if (latestAssistant && latestUser) {
      break;
    }
  }

  const bullets: string[] = [];
  const topic = extractTopic(latestUser);
  if (topic) {
    bullets.push(topic);
  }
  const next = extractNext(latestAssistant);
  if (next) {
    bullets.push(`${nextPrefix(`${latestUser} ${latestAssistant}`)}: ${next}`);
  }

  if (bullets.length === 0) {
    return null;
  }
  return { bullets: bullets.slice(0, MAX_BULLETS) };
}
