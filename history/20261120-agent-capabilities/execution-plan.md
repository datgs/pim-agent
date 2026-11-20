---
status: proposed
last_reviewed: 2026-11-20
superseded_by: []
related_code:
  - src/extensions/bash/run.ts
  - src/extensions/subagent/subagent.ts
  - src/telegram/TaskScheduler.ts
  - src/telegram/TaskStore.ts
  - src/telegram/Bot.ts
  - src/shared/ModelResolver.ts
---

# Execution Plan: Agent Capabilities from Peer Coding Agents

Team: hd-agent-capabilities
Path: Standard

## Outcome and Approach
Implement the six requested capabilities with safe lifecycle boundaries. Background shell/subagent work is process-local and explicitly cancelled at shutdown in v1. Automations remain Telegram-first, retaining schedules and adding MCP events. Trust reporting is advisory. Pi and Telegram each expose a host-appropriate status view. Model comparison is text-only and has no tools. See [discovery.md](discovery.md) and [approach.md](approach.md).

## Tasks
| # | Task | Blocked by | Ownership | Output contract |
|---|---|---|---|---|
| 1 | Add process-local background job lifecycle for shell timeouts | — | `src/extensions/bash/**`, shared job registry only if needed | Job ID/state/result contract and shutdown/abort semantics, covered by tests |
| 2 | Add opt-in background subagent execution and parent completion notification | 1 (reuse job/status contract only if compatible; otherwise define subagent-local contract) | `src/extensions/subagent/**` | Background mode, process-local lifecycle, cancellation, completion notification; existing foreground mode unchanged |
| 3 | Add `watch` probe triggers to Telegram automation scheduler | — | `src/telegram/TaskSchema.ts`, `TaskScheduler.ts`, `TaskStore.ts`, `TaskTool.ts` | Persisted watch trigger (command + interval + fingerprint) contract; fires on output change; existing task records continue to load |
| 4 | Add project configuration trust/source report | — | New trust discovery extension/module and tests; Pi API integration per docs | Advisory report of project vs user/global config origins, no secrets, no blocking |
| 5 | Add unified activity/task status views in Pi and Telegram | 1, 2, 3, 4 | Pi command/status integration and Telegram command integration; no ownership of lifecycle internals | Each host presents only state it can observe; status contract labels process-local and persisted items |
| 6 | Add read-only model comparison | — | New compare capability under extensions; reuse `ModelResolver` where suitable | Parallel text-only model outputs; no tool access, bounded requests/results, partial failures surfaced |
| 7 | Integration, docs and full verification | 1, 2, 3, 4, 5, 6 | Integration owner; targeted docs/history only | Full checks pass; behaviors and lifecycle limits documented |

## Execution Guidance
- Critical path: Task 1 and Task 2 are prerequisites for complete process-local activity status; Task 3 must be ready before Task 5 shows Telegram automations. Task 4 feeds Task 5 only if the report includes current warnings.
- Safe parallel work: Tasks 1, 3, 4, and 6 can start in parallel after API verification. Task 2 can proceed independently if it does not share the registry contract; otherwise wait for Task 1's job ID/state contract. Task 5 waits on its state sources.
- Shared hubs or integration owners: Task 5 and Task 7 own command registries and package integration; avoid concurrent edits to extension registries, Telegram command lists, shared schemas, lockfiles, or package exports. Task 3 owns TaskSchema/TaskStore format changes.
- Discovery gate resolved: pi 1.3.0 does not expose MCP server push notifications to extensions (`mcp_servers_change` is the only MCP event; verified in `docs/mcp.md` and `extensions.md`). Task 3 therefore implements `watch` probe triggers instead of MCP events — the approved gate revision. Project trust surface verified in `docs/security.md` for Task 4 provenance enumeration.
- Task 1 design gate: define whether timeout automatically backgrounds and whether an explicit parameter can opt out; preserve explicit AbortSignal cancellation. Output spill/cache lifetime and bounded job concurrency need acceptance tests.
- Task 2 design gate: define how a completed background subagent is delivered without replaying side effects or settling a tool call twice; don't promise survival across process restart.
- Task 4 must not claim that a source is safe/trusted merely because it was enumerated. It reports origin and risk-relevant declarations only.
- Task 6 should use model registry/auth without returning credentials; cap candidate count and output size, and report per-model failures without cancelling successful peers.

## Verification Strategy
- Task checks: focused Bun tests for timeout/background process state, shutdown cleanup, subagent completion/abort, scheduler persistence and event deduplication, trust-source parsing/redaction, host status visibility, model fan-out/errors/output cap.
- Integration checks: simulated MCP event delivery and reconnect; Telegram scheduled task execution after restart; parent session receives a background subagent result exactly once within one process; Pi and Telegram status commands show appropriate active and completed states.
- Final acceptance: `bun run check`; test all legacy scheduler JSON and foreground bash/subagent behavior; manually verify commands/tool descriptions and lifecycle warnings.

## Risks and Approval
- Accepted assumptions: local process restart cancels shell/subagent jobs; no Git provider or public webhook trigger in v1; trust reporting is advisory; model comparison invokes no tools.
- Open risks: Pi may not provide enough provenance metadata for comprehensive configuration-origin reporting — Task 4 enumerates protected resources per `docs/security.md` instead of relying on pi internals; `watch` probes run with the daemon's permissions and must be treated as user-authored commands.
- User approval: plan requested on 2026-11-20; execution has not been approved.

## Live Plan Rule
Workers may submit evidence-backed plan-change proposals. Material scope or risk changes require review before execution continues.
