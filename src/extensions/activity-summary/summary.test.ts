import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildActivitySummary } from "./summary";

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

describe("buildActivitySummary", () => {
  test("returns null for empty history", () => {
    expect(buildActivitySummary([])).toBeNull();
  });

  test("shows the latest user request as the current topic", () => {
    const s = buildActivitySummary([
      user("Hãy implement activity summary widget"),
    ]);
    expect(s?.bullets).toEqual(["Hãy implement activity summary widget"]);
  });

  test("includes an explicitly stated next step", () => {
    const s = buildActivitySummary([
      user("Cập nhật plan"),
      assistant("Đã đọc xong.\nTiếp theo: viết extension activity-summary"),
    ]);
    expect(s?.bullets).toEqual([
      "Cập nhật plan",
      "Tiếp theo: viết extension activity-summary",
    ]);
  });

  test("uses 'Next' prefix for non-Vietnamese text", () => {
    const s = buildActivitySummary([
      user("Fix the widget"),
      assistant("Done reading.\nNext: write the tests"),
    ]);
    expect(s?.bullets).toEqual(["Fix the widget", "Next: write the tests"]);
  });

  test("prefers a structured plan when present", () => {
    const s = buildActivitySummary([
      user("Implement feature"),
      assistant(
        "Plan:\n1. [DONE:1] Explore codebase\n2. Implement widget\n3. Write tests"
      ),
    ]);
    expect(s?.bullets).toEqual(["Implement widget", "Next: Write tests"]);
  });

  test("plan items keep the conversation language", () => {
    const s = buildActivitySummary([
      user("Làm việc này"),
      assistant("Plan:\n1. Đọc code\n2. Viết widget\n3. Chạy test"),
    ]);
    expect(s?.bullets).toEqual(["Đọc code", "Tiếp theo: Viết widget"]);
  });

  test("truncates long topics", () => {
    const long = "a".repeat(200);
    const s = buildActivitySummary([user(long)]);
    expect(s?.bullets[0]!.length).toBeLessThanOrEqual(120);
  });
});
