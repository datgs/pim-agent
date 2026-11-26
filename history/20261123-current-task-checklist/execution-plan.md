---
status: proposed
last_reviewed: 2026-11-23
superseded_by: []
related_code:
  - src/extensions/tasks-view/index.ts
  - docs/pi-api.md
  - docs/rendering.md
---

# Execution Plan: Current Task Checklist

Team: current-task-checklist
Path: Standard

## Outcome and Approach
Show a persistent, very short bullet summary near the composer describing what the agent is working on and may do next. Prefer structured plan/context when available; otherwise derive deterministically from the latest user request and explicit agent progress signals at meaningful milestones. If a next step is not supported, show only the current topic. Do not enumerate every tool call or background job, claim exact completion status, or make a separate LLM call for summary generation in v1. See [discovery.md](discovery.md) and [approach.md](approach.md).

## Tasks
| # | Task | Blocked by | Ownership | Output contract |
|---|---|---|---|---|
| 1 | Define summary inputs and refresh milestones | — | Pi message/turn/tool lifecycle and session APIs | Specify context sources, regeneration triggers, cost/latency limits, and session branch/resume behavior.
| 2 | Implement concise activity-summary generation | 1 | Summary generation/state and focused tests | Produces a brief deterministic bullet list in conversation language from structured context/latest request and explicit progress signals; omits unsupported next steps; refreshes at meaningful milestones, not every tool call; makes no separate LLM call. |
| 3 | Implement persistent compact summary UI | 2 | UI widget/component and focused tests | Short bullets remain visible near composer in long sessions; follow rendering cache rules and preserve built-in footer. Expanded panel is optional, only if it adds clear value. |
| 4 | Integration, docs, and full verification | 2, 3 | Integration owner; targeted docs and tests | Behavior documented; `bun run check` passes; manual checks cover refresh milestones, long-session return, and session navigation. |

## Execution Guidance
- Critical path: Task 1 defines context sources and regeneration cadence; summary generation (2) precedes UI (3).
- Safe parallel work: No implementation parallelism is recommended before Task 1 because UI state and rendering depend on the verified source contract. Task 2 and 3 share the UI component and should remain sequential.
- Shared hubs or integration owners: Keep ownership of widget/overlay/command wiring in one extension. Do not modify footer replacement behavior or session history format.
- UI implementation must follow `docs/rendering.md`; inspect Pi overlay examples and keybinding conventions during execution.
- Keep plan steps short and verifiable. The compact summary must remain near the composer, including when the user returns to a long transcript. Task-to-activity filtering and plan/permission modes are explicitly out of scope; revisit only as separate approved features.

## Verification Strategy
- Task checks: Tests cover concise bullets, language behavior, structured-plan preference, deterministic no-plan fallback, omission of unsupported next steps, regeneration cadence, no separate LLM invocation, and branch/resume handling.
- Integration checks: Verify the summary stays near the composer after transcript navigation, updates at meaningful milestones, handles terminal widths, and leaves the footer/editor usable. Confirm it makes no exact completion claims.
- Final acceptance: `bun run check`; manual interactive checks in Pi for work-item emission, updates, session branch navigation, narrow/wide terminals, and no detected work items.

## Risks and Approval
- Accepted assumptions: Activity summary is concise and non-authoritative; prefer structured plan/context; deterministic fallback only; no separate LLM call, repeated chat messages, or background-job enumeration.
- Open risks: Without a structured plan, summary accuracy is limited to latest request and explicit progress signals; omit unsupported claims. Branch/session changes must not mix summaries.
- User approval: Plan requested on 2026-11-23; execution has not been approved.

## Live Plan Rule
If available context cannot produce a useful short summary, propose a minimal explicit summary signal before adding more infrastructure. Workers may submit evidence-backed plan-change proposals when other assumptions are invalidated.
