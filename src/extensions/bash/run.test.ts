import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpillCache } from "../../shared/SpillCache";
import {
  type BashRunOutcome,
  killAllActiveBashGroups,
  runBashCommand,
} from "./run";
import {
  type BashCommandResult,
  DRAIN_GRACE_MS,
  KILL_GRACE_MS,
  STREAM_HEAD_BYTES,
  STREAM_TAIL_BYTES,
} from "./schema";

let previousPimHomeDir: string | undefined;
let testPimHomeDir: string | undefined;

beforeAll(async () => {
  previousPimHomeDir = process.env.PIM_HOME_DIR;
  testPimHomeDir = await mkdtemp(join(tmpdir(), "pim-bash-home-"));
  process.env.PIM_HOME_DIR = testPimHomeDir;
});

afterAll(async () => {
  if (previousPimHomeDir === undefined) {
    delete process.env.PIM_HOME_DIR;
  } else {
    process.env.PIM_HOME_DIR = previousPimHomeDir;
  }
  if (testPimHomeDir) {
    await rm(testPimHomeDir, { recursive: true, force: true });
  }
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForNoProcess(
  marker: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const probe = Bun.spawnSync({ cmd: ["pgrep", "-f", marker] });
    if (probe.exitCode !== 0) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Process still running for marker ${marker}`);
    }
    await Bun.sleep(25);
  }
}

function expectResult(r: BashRunOutcome): BashCommandResult {
  if ("backgrounded" in r) {
    throw new Error("expected settled result, got backgrounded");
  }
  return r;
}

async function run(command: string, timeoutMs = 5000, cwd = process.cwd()) {
  return expectResult(await runBashCommand(command, timeoutMs, undefined, cwd));
}

describe("runBashCommand (integration)", () => {
  test("captures stdout from a successful command", async () => {
    const r = await run("echo hello");
    expect(r.exitCode).toBe(0);
    expect(r.aborted).toBe(false);
    expect(r.timedOut).toBe(false);
    expect(r.stdout.text.trim()).toBe("hello");
    expect(r.stderr.totalBytes).toBe(0);
  });

  test("captures stderr and non-zero exit", async () => {
    const r = await run("echo oops 1>&2; exit 3");
    expect(r.exitCode).toBe(3);
    expect(r.stderr.text.trim()).toBe("oops");
  });

  test("respects cwd", async () => {
    const r = await run("pwd", 5000, "/tmp");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.text.trim()).toBe(await realpath("/tmp"));
  });

  test("times out into a backgrounded outcome that resolves on exit", async () => {
    const r = await runBashCommand("sleep 0.1", 25, undefined, process.cwd());
    expect("backgrounded" in r && r.backgrounded).toBe(true);
    if (!("backgrounded" in r)) {
      throw new Error("expected backgrounded outcome");
    }
    const done = await r.done;
    expect(done.timedOut).toBe(true);
    expect(done.exitCode).toBe(0);
  });

  test("aborts when signal fires", async () => {
    const ctrl = new AbortController();
    const promise = runBashCommand("sleep 5", 5000, ctrl.signal, process.cwd());
    ctrl.abort();
    const r = expectResult(await promise);
    expect(r.aborted).toBe(true);
  });

  test("returns promptly when a backgrounded child inherits the pipe", async () => {
    const startedAt = Date.now();
    const r = await run("nohup sleep 47 > /dev/null 2>&1 & disown; echo done");
    const elapsed = Date.now() - startedAt;
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.stdout.text.trim()).toBe("done");
    expect(elapsed).toBeLessThan(2000);
    // clean up the orphaned sleep so it doesn't linger
    try {
      Bun.spawnSync({ cmd: ["pkill", "-f", "sleep 47"] });
    } catch {}
  });

  test("timed-out command keeps running until killed", async () => {
    const marker = `pim-test-timeout-${Date.now()}`;
    const startedAt = Date.now();
    const r = await runBashCommand(
      `bash -c ${shellQuote(`exec -a ${marker} sleep 60`)}`,
      50,
      undefined,
      process.cwd()
    );
    const elapsed = Date.now() - startedAt;
    if (!("backgrounded" in r)) {
      throw new Error("expected backgrounded outcome");
    }
    expect(elapsed).toBeLessThan(2000);
    // Still alive after the old kill window.
    await Bun.sleep(KILL_GRACE_MS + 200);
    expect(Bun.spawnSync({ cmd: ["pgrep", "-f", marker] }).exitCode).toBe(0);
    r.kill();
    await waitForNoProcess(marker, KILL_GRACE_MS + 3000);
    const done = await r.done;
    expect(done.timedOut).toBe(true);
    expect(done.signal === "SIGTERM" || done.signal === "SIGKILL").toBe(true);
  });

  test("does not crash on timeout while drains still hold readers", async () => {
    // Regression: stream.cancel() on a locked stream rejects (Bun throws
    // synchronously). Drains run fire-and-forget, so when a quiet command
    // times out (no output → drain blocked on read), the finally hits
    // cancel before drain has released. Unhandled rejection would crash Bun.
    const rejections: unknown[] = [];
    const onRejection = (err: unknown) => rejections.push(err);
    process.on("unhandledRejection", onRejection);
    try {
      const r = await runBashCommand("sleep 5", 25, undefined, process.cwd());
      expect("backgrounded" in r && r.backgrounded).toBe(true);
      if (!("backgrounded" in r)) {
        throw new Error("expected backgrounded outcome");
      }
      await Bun.sleep(25);
      expect(rejections).toEqual([]);
      r.kill();
      await r.done;
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  test.skipIf(process.platform !== "linux")(
    "bounded drain returns even when a daemon escapes our process group",
    async () => {
      // A child that calls setsid itself leaves our pgid and survives killGroup.
      // If it keeps the pipe open, drain would block forever; the DRAIN_GRACE_MS
      // bound forces us to return anyway. The marker lets us clean up after.
      const marker = `pim-test-detached-${Date.now()}`;
      const startedAt = Date.now();
      const r = await run(
        `setsid bash -c 'sleep 60; echo ${marker}' > /tmp/${marker}.out 2>&1 < /dev/null & disown; echo done`
      );
      const elapsed = Date.now() - startedAt;
      expect(r.exitCode).toBe(0);
      expect(r.stdout.text.trim()).toBe("done");
      expect(elapsed).toBeLessThan(DRAIN_GRACE_MS + 2000);
      try {
        Bun.spawnSync({ cmd: ["pkill", "-f", marker] });
        Bun.spawnSync({ cmd: ["rm", "-f", `/tmp/${marker}.out`] });
      } catch {}
    }
  );

  test("kill() stops a backgrounded job's process group", async () => {
    const marker = `pim-test-kill-${Date.now()}`;
    const r = await runBashCommand(
      `bash -c ${shellQuote(`exec -a ${marker} sleep 60`)}`,
      50,
      undefined,
      process.cwd()
    );
    if (!("backgrounded" in r)) {
      throw new Error("expected backgrounded outcome");
    }
    r.kill();
    const done = await r.done;
    expect(done.timedOut).toBe(true);
    expect(done.exitCode === null || done.exitCode !== 0).toBe(true);
    await waitForNoProcess(marker, KILL_GRACE_MS + 3000);
  });

  test("killAllActiveBashGroups sweeps in-flight subtrees", async () => {
    const id = Date.now();
    const marker = `/tmp/pim-test-active-${id}.marker`;
    const ready = `/tmp/pim-test-active-${id}.ready`;
    const processMarker = `pim-test-active-${id}`;
    const pending = runBashCommand(
      `touch ${shellQuote(ready)}; bash -c ${shellQuote(`exec -a ${processMarker} sleep 30`)} && touch ${shellQuote(marker)}`,
      30_000,
      undefined,
      process.cwd()
    );
    try {
      await waitForFile(ready, 1000);
      killAllActiveBashGroups("SIGTERM");
      const result = expectResult(await pending);
      expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
      await waitForNoProcess(processMarker, KILL_GRACE_MS + 500);
      expect(await Bun.file(marker).exists()).toBe(false);
    } finally {
      Bun.spawnSync({ cmd: ["rm", "-f", marker, ready] });
    }
  });

  test("truncates very large stdout", async () => {
    const totalBytes = STREAM_HEAD_BYTES + STREAM_TAIL_BYTES + 1000;
    const r = await run(`head -c ${totalBytes} /dev/zero | tr '\\0' 'A'`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.totalBytes).toBe(totalBytes);
    expect(r.stdout.truncated).toBe(true);
    expect(r.stdout.text).toContain("bytes truncated");
  });

  test("spills full stdout to ~/.pim/cache when truncated", async () => {
    const totalBytes = STREAM_HEAD_BYTES + STREAM_TAIL_BYTES + 4096;
    const r = await run(`head -c ${totalBytes} /dev/zero | tr '\\0' 'A'`);
    try {
      expect(r.exitCode).toBe(0);
      expect(r.stdout.truncated).toBe(true);
      expect(r.stdout.path).toBeTruthy();
      expect(r.stdout.path!.startsWith(join(SpillCache.dir(), "bash-"))).toBe(
        true
      );
      expect(r.stdout.path!.endsWith(".out")).toBe(true);
      const cacheMode = (await stat(SpillCache.dir())).mode & 0o777;
      const spillMode = (await stat(r.stdout.path!)).mode & 0o777;
      expect(cacheMode).toBe(0o700);
      expect(spillMode).toBe(0o600);
      const spilled = await Bun.file(r.stdout.path!).text();
      expect(spilled.length).toBe(totalBytes);
      expect(spilled).toBe("A".repeat(totalBytes));
    } finally {
      if (r.stdout.path) {
        try {
          Bun.spawnSync({ cmd: ["rm", "-f", r.stdout.path] });
        } catch {}
      }
    }
  });

  test("omits spill path when stream is empty", async () => {
    const r = await run("true");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.path).toBeNull();
    expect(r.stderr.path).toBeNull();
  });
});
