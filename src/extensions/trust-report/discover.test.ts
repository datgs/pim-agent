import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverConfig } from "./discover";

let root: string;
let previousAgentDir: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pim-trust-"));
  previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
  // Point the agent dir at an empty temp dir so user-level fixtures only
  // exist when a test creates them.
  process.env["PI_CODING_AGENT_DIR"] = join(root, "agent-dir");
  await mkdir(process.env["PI_CODING_AGENT_DIR"], { recursive: true });
});

afterEach(async () => {
  if (previousAgentDir === undefined) {
    delete process.env["PI_CODING_AGENT_DIR"];
  } else {
    process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
  }
  await rm(root, { recursive: true, force: true });
});

describe("discoverConfig", () => {
  test("reports nothing for a bare directory", async () => {
    const report = await discoverConfig(root);
    expect(report.entries).toHaveLength(0);
    expect(report.executableProjectEntries).toHaveLength(0);
    expect(report.trustDecisions).toHaveLength(0);
  });

  test("enumerates protected .pi resources with scope and declarations", async () => {
    const piDir = join(root, ".pi");
    await mkdir(join(piDir, "extensions"), { recursive: true });
    await writeFile(
      join(piDir, "settings.json"),
      JSON.stringify({
        packages: ["npm:some/pkg"],
        extensions: ["./evil.ts"],
        defaultModel: "proxy/x",
      })
    );
    await writeFile(
      join(piDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          local: { command: "npx", env: { KEY: "secret", OTHER: "x" } },
          remote: {
            url: "https://user:pass@api.example.com/mcp?token=abc#frag",
          },
        },
      })
    );
    await writeFile(join(piDir, "APPEND_SYSTEM.md"), "steer the model");

    const report = await discoverConfig(root);
    const byCategory = new Map(report.entries.map((e) => [e.category, e]));

    const settings = byCategory.get("settings")!;
    expect(settings.scope).toBe("project");
    expect(settings.executable).toBe(true);
    expect(settings.details.join(" ")).toContain("extensions: ./evil.ts");
    expect(settings.details.join(" ")).toContain("packages: npm:some/pkg");

    const mcp = byCategory.get("mcp servers")!;
    const mcpDetails = mcp.details.join("\n");
    // URL credentials, query and env values are redacted.
    expect(mcpDetails).not.toContain("pass");
    expect(mcpDetails).not.toContain("token=abc");
    expect(mcpDetails).not.toContain("secret");
    expect(mcpDetails).toContain("local: runs npx env keys: KEY, OTHER");
    expect(mcpDetails).toContain("https://api.example.com/mcp");

    expect(report.executableProjectEntries.length).toBeGreaterThanOrEqual(4);
  });

  test("finds .agents/skills and context files in ancestors", async () => {
    await mkdir(join(root, ".agents", "skills", "s1"), { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "rules");
    const nested = join(root, "a", "b");
    await mkdir(nested, { recursive: true });

    const report = await discoverConfig(nested);
    const paths = report.entries.map((e) => e.path);
    expect(paths).toContain(join(root, ".agents", "skills"));
    expect(paths).toContain(join(root, "AGENTS.md"));
    expect(
      report.entries.find((e) => e.path.endsWith("AGENTS.md"))?.category
    ).toContain("loads regardless of trust");
  });

  test("marks user-level settings as user scope", async () => {
    await writeFile(
      join(process.env["PI_CODING_AGENT_DIR"]!, "settings.json"),
      JSON.stringify({ defaultModel: "x" })
    );
    const report = await discoverConfig(root);
    const user = report.entries.find((e) => e.scope === "user");
    expect(user?.category).toBe("settings");
    expect(report.executableProjectEntries).toHaveLength(0);
  });

  test("reports saved trust decisions for the dir chain", async () => {
    await writeFile(
      join(process.env["PI_CODING_AGENT_DIR"]!, "trust.json"),
      JSON.stringify({ [root]: "approved", "/elsewhere": "denied" })
    );
    const report = await discoverConfig(root);
    expect(report.trustDecisions).toHaveLength(1);
    expect(report.trustDecisions[0]).toContain(root);
  });
});
