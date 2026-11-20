import { StreamCapture } from "./capture";
import {
  type BashCommandResult,
  DRAIN_GRACE_MS,
  KILL_GRACE_MS,
} from "./schema";

type Reader = ReadableStreamDefaultReader<Uint8Array>;

const activePids = new Set<number>();

// Wired into the extension's signal handlers so a daemon that detaches
// out of our group (or harbor/parent SIGTERM) still tears down its subtree.
export function killAllActiveBashGroups(sig: NodeJS.Signals = "SIGTERM"): void {
  for (const pid of activePids) {
    killGroup(pid, sig);
  }
  activePids.clear();
}

async function drain(reader: Reader | null, cap: StreamCapture): Promise<void> {
  if (!reader) {
    return;
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        cap.push(value);
      }
    }
  } catch {
    // reader cancelled; drop remaining bytes
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

function killGroup(pid: number | undefined, sig: NodeJS.Signals): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      process.kill(pid, sig);
    } catch {}
  }
}

function getReader(
  stream: ReadableStream<Uint8Array> | undefined
): Reader | null {
  return stream ? stream.getReader() : null;
}

export type BashRunOutcome =
  | BashCommandResult
  | {
      // The command is still running past its timeout; `done` resolves with
      // its final result once it exits, is killed, or the process ends.
      readonly backgrounded: true;
      readonly done: Promise<BashCommandResult>;
      readonly kill: () => void;
      readonly stdout: { readonly totalBytes: number };
      readonly stderr: { readonly totalBytes: number };
    };

export async function runBashCommand(
  command: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<BashRunOutcome> {
  const startedAt = Date.now();
  const stdoutCap = new StreamCapture({ prefix: "bash", ext: "out" });
  const stderrCap = new StreamCapture({ prefix: "bash", ext: "err" });

  // Bun's detached mode creates a fresh session/process group on POSIX,
  // equivalent to setsid(2), without depending on the Linux-only `setsid`
  // executable. pgid == proc.pid, so timeout/abort can signal the whole tree.
  // Windows has no process groups, so detached is disabled there to avoid
  // spawning an extra hidden console window.
  const isWindows = process.platform === "win32";
  const proc = Bun.spawn({
    cmd: ["bash", "-lc", command],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: env ?? { ...process.env },
    detached: !isWindows,
    windowsHide: isWindows,
  });
  if (proc.pid !== undefined) {
    activePids.add(proc.pid);
  }

  let timedOut = false;
  let aborted = false;

  // We own the readers so we can force-cancel them later even while the
  // background drains are still mid-read. Cancelling via the held reader
  // does not throw the way ReadableStream.cancel() on a locked stream does.
  const stdoutReader = getReader(
    proc.stdout as unknown as ReadableStream<Uint8Array>
  );
  const stderrReader = getReader(
    proc.stderr as unknown as ReadableStream<Uint8Array>
  );

  // Fire-and-forget drains. A backgrounded child can inherit the subshell's
  // fds and keep the pipes open after bash exits, so we can't block on EOF;
  // we race proc.exited against a wall-clock timeout instead.
  const stdoutDrain = drain(stdoutReader, stdoutCap);
  const stderrDrain = drain(stderrReader, stderrCap);

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const exitedPromise = proc.exited.then(() => "exited" as const);
  let timeoutPromise = new Promise<"timeout">((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    // Unref'd: a caller that drops the returned handle should not keep the
    // event loop alive on the timeout alone.
    timer.unref?.();
    timeoutHandle = timer;
  });

  let abortResolve: ((v: "aborted") => void) | null = null;
  const abortPromise = new Promise<"aborted">((resolve) => {
    abortResolve = resolve;
  });
  const onAbort = () => {
    aborted = true;
    abortResolve?.("aborted");
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const settle = async (): Promise<BashCommandResult> => {
    let exitCode: number | null = null;
    let signalCode: NodeJS.Signals | null = null;
    try {
      const result = await Promise.race([
        exitedPromise,
        timeoutPromise,
        abortPromise,
      ]);

      if (result === "timeout") {
        timedOut = true;
      }

      if (result !== "exited") {
        killGroup(proc.pid, "SIGTERM");
        const sigkillTimer = setTimeout(() => {
          killGroup(proc.pid, "SIGKILL");
        }, KILL_GRACE_MS);
        try {
          await proc.exited;
        } finally {
          clearTimeout(sigkillTimer);
        }
      }

      exitCode = proc.exitCode ?? null;
      signalCode =
        (proc.signalCode as NodeJS.Signals | null | undefined) ?? null;

      // Bound the drain so a detached grandchild holding the pipe can't keep
      // the drain promise + capture buffer alive past this call.
      await Promise.race([
        Promise.all([stdoutDrain, stderrDrain]),
        Bun.sleep(DRAIN_GRACE_MS),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      for (const reader of [stdoutReader, stderrReader]) {
        if (!reader) {
          continue;
        }
        try {
          void reader.cancel().catch(() => {});
        } catch {}
      }
      if (proc.pid !== undefined) {
        activePids.delete(proc.pid);
      }
    }

    const stdoutPath = stdoutCap.finishSpill();
    const stderrPath = stderrCap.finishSpill();

    return {
      exitCode,
      signal: signalCode,
      stdout: { ...stdoutCap.snapshot(), path: stdoutPath },
      stderr: { ...stderrCap.snapshot(), path: stderrPath },
      timedOut,
      aborted,
      durationMs: Date.now() - startedAt,
    };
  };

  const result = await Promise.race([
    exitedPromise.then(() => "exited" as const),
    timeoutPromise,
    abortPromise,
  ]);

  if (result === "exited") {
    return settle();
  }

  if (result === "aborted") {
    return settle();
  }

  // Timeout: the command keeps running in the background. Drains keep
  // capturing output into the same bounded buffers; `done` resolves with
  // the final result after exit, kill, or the drain grace bound. The elapsed
  // timeout promise is replaced so the settle race can't resolve "timeout"
  // again and kill the group.
  timedOut = true;
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
  timeoutPromise = new Promise<"timeout">(() => {});
  const done = settle();

  return {
    backgrounded: true,
    done: done.then((r) => ({ ...r, timedOut: true })),
    kill: () => {
      killGroup(proc.pid, "SIGTERM");
      setTimeout(() => {
        killGroup(proc.pid, "SIGKILL");
      }, KILL_GRACE_MS).unref?.();
    },
    stdout: { totalBytes: stdoutCap.totalBytes },
    stderr: { totalBytes: stderrCap.totalBytes },
  };
}
