---
status: proposed
last_reviewed: 2026-11-20
superseded_by: []
related_code:
  - src/extensions/bash/run.ts
  - src/extensions/subagent/subagent.ts
  - src/telegram/TaskScheduler.ts
  - src/telegram/TaskSchema.ts
  - src/telegram/TaskStore.ts
  - src/telegram/Bot.ts
  - src/extensions/provider/index.ts
---

# Discovery: Agent Capabilities from Peer Coding Agents

## Outcome and Scope
- Desired behavior: adopt six high-value capabilities from recent coding-agent products: background shell jobs, background subagents, event-driven automation, trust-source warnings, a unified task/job view, and model comparison.
- Users: HD Agent users in Pi CLI and Telegram.
- Non-goals: implement now; make Telegram scheduler a general Pi scheduler; browser/voice/live-app features; subagent execution that survives HD Agent process restart in the first release; model comparisons that invoke tools or modify a workspace.

## Evidence
- `src/extensions/bash/run.ts:143-157` — timeout and abort both terminate the process group with SIGTERM/SIGKILL; active process groups are tracked and cleaned up at `:183-185`.
- `src/extensions/subagent/subagent.ts:568-597` — subagent waits for `session.prompt()`, then disposes the child session. Its tool is registered parallel in `src/extensions/subagent/index.ts:54-75`.
- `src/telegram/TaskScheduler.ts:17-35,195-251` — Telegram has a persistent task scheduler with once/interval/cron-like schedule types and serialized tick execution.
- `src/telegram/TaskSchema.ts:3-19` — scheduled records are scoped to chat/thread and store prompt, schedule, status and next run.
- `src/telegram/Bot.ts:22-35,116-127` — Bot owns scheduler and executes scheduled prompts in a Telegram session.
- `src/extensions/provider/index.ts:19-22` and `src/shared/ModelResolver.ts:17-48` — providers are registered in Pi, and model references resolve to ordered candidates; a compare feature can reuse resolution but should call read-only inference directly rather than normal subagents with tools.
- `docs/pi-api.md:23-29` — Pi exposes extension commands/tools/events and model registry in the current integration surface.
- Exa research, OpenCode v2.3.1 changelog: timed-out shell commands move to background instead of being killed; official page: https://opencode.ai/changelog/v2.3.1
- Exa research, OpenCode v2.3.0 changelog: background subagents return immediately and report when idle; official page: https://opencode.ai/changelog/v2.3.0
- Exa research, OpenCode PR #44844 and issue #36349: restart recovery requires durable job records, stable notification IDs, startup reconciliation, parent/child delivery state, bounded retries and ordering rules. Evidence shows this is a materially larger feature than process-local backgrounding; restart continuity also has operational gaps in some server modes.
- Exa research, Cursor Automations docs: scheduled and source-control/event triggers are supported; GitHub/GitLab/Bitbucket, Slack, webhooks and Linear are among trigger sources. The source-control path needs connected repos and authenticated provider integrations. Official page: https://cursor.com/docs/cloud-agent/automations
- Exa research, Cursor Agent SDK docs: event channels resume the same conversation session for follow-up events; official page: https://cursor.com/docs/agent-sdk

## Existing Contracts and Patterns
- Bash timeout and shutdown cleanup are owned by `runBashCommand`; captured streams spill to managed cache and are bounded.
- Subagent creation, lifecycle, retry/fallback, abort and disposal are owned by `runSubagent`.
- Telegram `TaskScheduler` uses `TaskStore` JSON persistence and calls a host-provided `runTask` callback.
- Pi commands/tools should use `Tools.register` and the project Pi API guidance.
- `ModelResolver` already handles model aliases/providers and auth resolution.

## Constraints
- Technical: Bun-native; relative imports only; `bun run check` after each change; package supports Pi >=1.2.
- Operations: daemon shutdown currently kills active shell groups; scheduled tasks survive restart as JSON records, but active executions are not a general durable job system.
- Security/data: background shell retains the same command authority it had in foreground; automated event prompts may act on repository state; project configuration and hooks can influence execution and need trustworthy source attribution.
- UI standard: follow existing Pi command/render patterns and Telegram command conventions; no separate design system introduced.

## Facts, Assumptions, Questions
- Verified: shell timeout currently kills; subagent currently blocks; Telegram scheduler already supports once/interval/cron; model resolution exists.
- Assumed: first release keeps shell/subagent jobs process-local and cancels them at shutdown; only scheduled automation definitions persist.
- Assumed: event-driven automation is Telegram-only initially; implemented as `watch` probe triggers (shell command polled on interval, fires on output change) because pi 1.3.0 does not expose MCP server push notifications to extensions — verified against `node_modules/@earendil-works/pi-coding-agent/docs/mcp.md` (only `mcp_servers_change` exists) and `security.md` (project trust covers `.pi/settings.json`, `.pi/mcp.json`, `.pi/extensions|skills|prompts|themes`, `.pi/SYSTEM.md|APPEND_SYSTEM.md`, `.agents/skills`).
- Open: exact configuration discovery/trust flow must be checked against the installed Pi 1.3.0 behavior before implementation; warnings must distinguish project-local from user-managed sources and avoid printing secrets.

## Clarifications
- Background subagents: keep in-process only; Exa restart-continuity research confirms durable recovery has substantially broader job/session semantics, so restart persistence is deferred.
- Automations: Telegram-first, keep cron and add `watch` probe triggers; MCP push and Git provider events are not in v1 — pi does not surface MCP notifications to extensions, and provider auth/webhook integration is a separate operational boundary.
- Model comparison: independent text-only inference; no tools.
- Trust warnings: cover all discovered project-level configuration sources, not just hooks; keep user/global trusted sources separate.
- Task/job view: expose in Pi CLI and Telegram, backed by the relevant host's tasks/jobs rather than promising a durable cross-host job catalog.
