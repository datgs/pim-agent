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

# Approach: Agent Capabilities from Peer Coding Agents

## Recommendation
Deliver six capabilities with explicit host and lifecycle boundaries. Add a process-local job registry for long shell commands and subagents, while leaving current foreground execution as the default. Keep persisted schedules in Telegram's existing scheduler and add MCP event triggers there. Build trust attribution as an advisory discovery/reporting path before execution, not as a new permission engine. Expose status through existing Pi command and Telegram command surfaces. Compare models using parallel text-only requests with no tools and a bounded result summary.

A shell command that reaches its timeout should move into background and return a job ID; an explicit user/session abort still cancels it. Subagents gain an explicit background mode; background runs can finish and notify their parent while the process remains alive. Both job types are cancelled at process shutdown in this release. Durable restart recovery is deferred until a general job/session delivery contract is designed.

Automation v1 remains Telegram-first: retain once/interval/cron and add a `watch` trigger — a user-provided shell probe command polled on an interval that fires the task when its output changes. This delivers event-driven behavior over arbitrary local state (git refs, files, HTTP endpoints, MCP-backed CLIs) within the existing scheduler. MCP server push events were dropped: pi 1.3.0 does not expose MCP server notifications to extensions, and Cursor/Agent-SDK evidence treats MCP as a tool source, not a trigger source. Persist probe fingerprint state in TaskStore. Do not add GitHub/GitLab webhooks or local Git polling in v1.

The task view is a unified presentation of supported local state, not a claim that jobs are durable or cross-process. Pi view shows current process-local shell/subagent jobs; Telegram view shows scheduled definitions and active scheduled runs available to the daemon. Unknown or restarted in-flight work must be labeled accurately.

Trust reporting should identify project-local configuration sources (including settings, extension/agent/skill declarations where discoverable), distinguish them from user/global sources, and summarize executable or behavior-changing entries without exposing secret values. For v1 it informs users and does not block loading.

## Meaningful Alternatives
- Persist background subagents across restarts — deferred because it needs durable parent/child invocation identity, completion inbox/outbox, idempotent notification, startup reconciliation and cancellation semantics; Exa's OpenCode evidence shows these are coupled contracts, not a small persistence toggle.
- MCP push-event triggers — dropped: pi 1.3.0's MCP surface exposes tools and `mcp_servers_change`, not server-initiated notifications, and a second bespoke subscription channel would duplicate connection/auth lifecycle. The `watch` trigger covers MCP-adjacent sources via probe commands.
- Git triggers in automation v1 — deferred because they need authenticated provider/webhook or polling lifecycle, repository binding, deduplication and event coalescing. Cursor's event automation docs demonstrate these are provider integrations, distinct from local scheduling.
- Compare models with tool access — rejected for v1 because parallel model agents could repeat side effects; text-only requests isolate evaluation.

## Contracts and Integration
- Inputs: shell command timeout, subagent foreground/background choice, Telegram scheduled prompt and optional MCP event selector, discovered project/user config roots, model list + prompt for comparison.
- Outputs: process-local job ID/state/result; bounded parent notification for completed background subagent; persisted automation schedule/event definition; non-blocking source-attribution warning/report; Pi and Telegram status summaries; side-by-side model outputs with model IDs and usage when available.
- Compatibility: existing bash foreground behavior remains for completion before timeout; explicit abort retains cancellation semantics; existing scheduled task JSON remains loadable; existing subagent calls stay foreground unless `background` is requested; feature schemas are additive.

## Risk and Evidence
| Area | Risk | Evidence or validation |
|---|---|---|
| Shell jobs | medium | Current timeout kills the full group (`run.ts:143-157`); test lifecycle, output capture and shutdown cancellation. |
| Background subagents | high | Current attempt disposes child after prompt (`subagent.ts:568-597`); validate parent notification, duplicate delivery prevention within process, cancellation and bounded concurrency. |
| Watch-trigger automation | medium | Scheduler is Telegram-owned and persisted (`TaskScheduler.ts`, `TaskStore.ts`); watch probes run with daemon's OS permissions, must be bounded, timed-out, and fingerprinted to avoid duplicate fires. |
| Trust attribution | medium | Project config surface must be discovered from Pi 1.3.0 docs/source; warning-only prevents behavior change, but avoid secret disclosure and false trust claims. |
| Unified status view | medium | Pi and Telegram have separate host lifecycles; tests must distinguish process-local jobs from persistent schedules. |
| Model comparison | medium | Registry/auth resolution is present (`ModelResolver.ts`); tests must ensure no tool calls, bounded parallelism/output, clear provider failures and no credential logging. |

## Migration, Operations, and Rollback
- Migration: preserve old scheduled task records; make any new trigger fields optional/additive with explicit validation. No migration for ephemeral jobs.
- Observability: job IDs, lifecycle state, duration, and terminal reason; avoid command secrets or complete prompts in logs. Surface stale/unknown status honestly after shutdown.
- Rollback: remove/disable new command/tool registrations and event listener; existing schedule records continue to be readable. Existing foreground shell/subagent paths remain available.

## Accepted Assumptions
- In-process shell and subagent jobs do not survive HD Agent shutdown/restart in v1.
- MCP server push events are out of scope; event-driven behavior ships as `watch` probes (poll external state, fire on change).
- Trust warnings are advisory and do not block project configuration loading.
- Text-only model comparisons do not use tools or write files.
- Project configuration sources are enumerated using current Pi-supported discovery behavior; implementation must verify it against installed Pi 1.3.0 before finalizing the warning list.
