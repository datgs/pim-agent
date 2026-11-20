import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Fs } from "../../shared/Fs";

export type TrustEntry = {
  readonly path: string;
  readonly scope: "project" | "user";
  readonly category: string;
  // Short facts shown to the user; values that could carry secrets are
  // redacted at extraction time (env values, URL credentials/queries).
  readonly details: readonly string[];
  // Executable or model-steering surface — drives the startup notice.
  readonly executable: boolean;
};

export type TrustReport = {
  readonly entries: readonly TrustEntry[];
  readonly trustDecisions: readonly string[];
  readonly executableProjectEntries: readonly TrustEntry[];
};

// Mirrors pi's protected-resource surface (docs/security.md) plus the
// context files pi loads regardless of trust.
const PROTECTED_FILES = [
  { name: "settings.json", category: "settings", executable: true },
  { name: "mcp.json", category: "mcp servers", executable: true },
  { name: "SYSTEM.md", category: "system prompt", executable: true },
  { name: "APPEND_SYSTEM.md", category: "system prompt", executable: true },
] as const;

const PROTECTED_DIRS = [
  { name: "extensions", category: "extensions", executable: true },
  { name: "skills", category: "skills", executable: true },
  { name: "prompts", category: "prompt templates", executable: true },
  { name: "themes", category: "themes", executable: false },
] as const;

const CONTEXT_FILES = ["AGENTS.override.md", "AGENTS.md", "CLAUDE.md"] as const;

export async function discoverConfig(cwd: string): Promise<TrustReport> {
  const chain = await dirChain(cwd);
  const entries: TrustEntry[] = [];

  for (const dir of chain) {
    const piDir = join(dir, ".pi");
    if (await isDir(piDir)) {
      for (const file of PROTECTED_FILES) {
        const path = join(piDir, file.name);
        if (await exists(path)) {
          entries.push({
            path,
            scope: "project",
            category: file.category,
            details: await describeProtectedFile(path, file.name),
            executable: file.executable,
          });
        }
      }
      for (const dirEntry of PROTECTED_DIRS) {
        const path = join(piDir, dirEntry.name);
        if (await isDir(path)) {
          entries.push({
            path,
            scope: "project",
            category: dirEntry.category,
            details: [`${await countEntries(path)} entries`],
            executable: dirEntry.executable,
          });
        }
      }
    }

    const agentSkills = join(dir, ".agents", "skills");
    if (await isDir(agentSkills)) {
      entries.push({
        path: agentSkills,
        scope: "project",
        category: "skills",
        details: [`${await countEntries(agentSkills)} entries`],
        executable: true,
      });
    }

    for (const name of CONTEXT_FILES) {
      const path = join(dir, name);
      if (await exists(path)) {
        entries.push({
          path,
          scope: "project",
          category: "context file (loads regardless of trust)",
          details: [],
          executable: true,
        });
      }
    }
  }

  const agentDir = process.env["PI_CODING_AGENT_DIR"]
    ? expandHome(process.env["PI_CODING_AGENT_DIR"]!)
    : join(homedir(), ".pi", "agent");
  const userSettings = join(agentDir, "settings.json");
  if (await exists(userSettings)) {
    entries.push({
      path: userSettings,
      scope: "user",
      category: "settings",
      details: await describeSettings(userSettings),
      executable: true,
    });
  }
  const userMcp = join(agentDir, "mcp.json");
  if (await exists(userMcp)) {
    entries.push({
      path: userMcp,
      scope: "user",
      category: "mcp servers",
      details: await describeMcp(userMcp),
      executable: true,
    });
  }

  return {
    entries,
    trustDecisions: await trustDecisionsFor(chain),
    executableProjectEntries: entries.filter(
      (e) => e.scope === "project" && e.executable
    ),
  };
}

async function describeProtectedFile(
  path: string,
  name: string
): Promise<readonly string[]> {
  if (name === "settings.json") {
    return describeSettings(path);
  }
  if (name === "mcp.json") {
    return describeMcp(path);
  }
  return [];
}

async function describeSettings(path: string): Promise<readonly string[]> {
  const settings = await Fs.readJsonOrEmpty<Record<string, unknown>>(path, {});
  const details: string[] = [];
  const keys = Object.keys(settings).filter((k) => k !== "$schema");
  if (keys.length > 0) {
    details.push(`keys: ${keys.join(", ")}`);
  }
  for (const key of ["extensions", "packages", "skills"] as const) {
    const value = settings[key];
    if (Array.isArray(value) && value.length > 0) {
      details.push(
        `${key}: ${value
          .map((v) => String(v))
          .slice(0, 8)
          .join(", ")}` +
          (value.length > 8 ? ` (+${value.length - 8} more)` : "")
      );
    }
  }
  return details;
}

async function describeMcp(path: string): Promise<readonly string[]> {
  const doc = await Fs.readJsonOrEmpty<Record<string, unknown>>(path, {});
  const servers = doc["mcpServers"];
  if (typeof servers !== "object" || servers === null) {
    return ["no mcpServers key"];
  }
  const details: string[] = [];
  for (const [name, raw] of Object.entries(
    servers as Record<string, unknown>
  )) {
    const cfg = raw as Record<string, unknown>;
    const envKeys =
      typeof cfg["env"] === "object" && cfg["env"] !== null
        ? ` env keys: ${Object.keys(cfg["env"]).join(", ")}`
        : "";
    if (typeof cfg["command"] === "string") {
      details.push(`${name}: runs ${cfg["command"]}${envKeys}`);
    } else if (typeof cfg["url"] === "string") {
      details.push(`${name}: ${redactUrl(cfg["url"])}${envKeys}`);
    } else {
      details.push(`${name}: (unrecognized shape)`);
    }
  }
  return details.length > 0 ? details : ["no servers declared"];
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split("?", 1)[0]!;
  }
}

async function trustDecisionsFor(
  chain: readonly string[]
): Promise<readonly string[]> {
  const path = join(
    process.env["PI_CODING_AGENT_DIR"]
      ? expandHome(process.env["PI_CODING_AGENT_DIR"]!)
      : join(homedir(), ".pi", "agent"),
    "trust.json"
  );
  const doc = await Fs.readJsonOrEmpty<Record<string, unknown>>(path, {});
  const dirs = new Set(chain);
  const decisions: string[] = [];
  for (const [dir, decision] of Object.entries(doc)) {
    if (dirs.has(dir)) {
      decisions.push(`${dir}: ${JSON.stringify(decision)}`);
    }
  }
  return decisions;
}

async function dirChain(cwd: string): Promise<readonly string[]> {
  const dirs: string[] = [];
  let dir = cwd;
  const stop = await gitRoot(cwd);
  while (true) {
    dirs.push(dir);
    if (dir === stop || dir === dirname(dir)) {
      break;
    }
    dir = dirname(dir);
  }
  return dirs;
}

async function gitRoot(cwd: string): Promise<string | undefined> {
  try {
    const proc = Bun.spawnSync({
      cmd: ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = new TextDecoder().decode(proc.stdout).trim();
    return proc.exitCode === 0 && out ? out : undefined;
  } catch {
    return undefined;
  }
}

function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function countEntries(path: string): Promise<number> {
  try {
    return (await readdir(path)).length;
  } catch {
    return 0;
  }
}
