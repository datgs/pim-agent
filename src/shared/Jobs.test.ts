import { afterEach, describe, expect, test } from "bun:test";
import { Jobs, type Job } from "./Jobs";

afterEach(() => {
  Jobs.resetForTests();
});

describe("Jobs", () => {
  test("create assigns sequential ids and running status", () => {
    const a = Jobs.create({ kind: "bash", title: "first" });
    const b = Jobs.create({ kind: "subagent", title: "second" });
    expect(a.id).toBe("bash-1");
    expect(b.id).toBe("subagent-2");
    expect(a.status).toBe("running");
    expect(Jobs.get(a.id)?.title).toBe("first");
  });

  test("list returns newest first", () => {
    const a = Jobs.create({ kind: "bash", title: "a" });
    const b = Jobs.create({ kind: "bash", title: "b" });
    expect(Jobs.list().map((j) => j.id)).toEqual([b.id, a.id]);
  });

  test("setStatus transitions once and ignores late updates", () => {
    const job = Jobs.create({ kind: "bash", title: "x" });
    const cancelled = Jobs.cancel(job.id);
    expect(cancelled).toBe(true);
    const late = Jobs.setStatus(job.id, "completed", { exitCode: 0 });
    expect(late?.status).toBe("cancelled");
    expect(Jobs.get(job.id)?.endedAt).not.toBeNull();
  });

  test("cancel invokes onCancel and fails for settled jobs", () => {
    let calls = 0;
    const job = Jobs.create({
      kind: "bash",
      title: "x",
      onCancel: () => {
        calls++;
      },
    });
    expect(Jobs.cancel(job.id)).toBe(true);
    expect(calls).toBe(1);
    expect(Jobs.get(job.id)?.status).toBe("cancelled");
    expect(Jobs.cancel(job.id)).toBe(false);
  });

  test("cancel returns false for unknown ids", () => {
    expect(Jobs.cancel("nope-999")).toBe(false);
  });

  test("setStatus records exit code and output", () => {
    const job = Jobs.create({ kind: "bash", title: "x" });
    const done = Jobs.setStatus(job.id, "failed", {
      exitCode: 1,
      error: "boom",
      output: { stdout: { totalBytes: 10, path: "/tmp/x" } },
    });
    expect(done?.exitCode).toBe(1);
    expect(done?.error).toBe("boom");
    expect(done?.output.stdout?.path).toBe("/tmp/x");
  });

  test("subscribe notifies on create and settle", () => {
    const seen: Job[] = [];
    const unsub = Jobs.subscribe((j) => seen.push(j));
    const job = Jobs.create({ kind: "bash", title: "x" });
    Jobs.setStatus(job.id, "completed", { exitCode: 0 });
    unsub();
    const other = Jobs.create({ kind: "bash", title: "y" });
    expect(seen.map((j) => j.status)).toEqual(["running", "completed"]);
    expect(seen.every((j) => j.id === job.id)).toBe(true);
    void other;
  });

  test("rejects new jobs beyond the active cap", () => {
    for (let i = 0; i < 16; i++) {
      Jobs.create({ kind: "bash", title: `job-${i}` });
    }
    expect(() => Jobs.create({ kind: "bash", title: "overflow" })).toThrow(
      /too many background jobs/
    );
  });

  test("settled jobs are pruned to a bounded history", () => {
    for (let i = 0; i < 40; i++) {
      const j = Jobs.create({ kind: "bash", title: `job-${i}` });
      Jobs.setStatus(j.id, "completed", { exitCode: 0 });
    }
    expect(Jobs.list().length).toBeLessThanOrEqual(30);
  });
});
