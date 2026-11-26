---
status: proposed
last_reviewed: 2026-11-23
superseded_by: []
related_code:
  - src/extensions/tasks-view/index.ts
  - docs/pi-api.md
  - docs/rendering.md
---

# Discovery: Current Task Checklist

## Outcome and Scope
- Desired behavior: Keep a very short summary of what the agent is doing and may do next beside/above the composer. Format it as a small bullet list in the conversation language. Prefer structured plan/context when available; otherwise derive deterministically from the latest user request and explicit agent progress signals at meaningful milestones. If next step is unsupported, show only current topic.
- LLM constraint: Do not make a separate LLM call for summary generation in v1.
- Status scope: This is a relative activity summary, not an authoritative state tracker. Do not claim exact completion status or enumerate every tool call/background job.
- Users: People following an agent task in Pi's interactive terminal UI.
- Non-goals: Build a complete checklist/task system, show a background-job dashboard, send repeated summary messages in chat, or change Pi's plan/execution policy.

## Evidence
- `docs/pi-api.md` — Pi extensions can register commands, subscribe to session/tool events, and use `ctx.ui.setWidget` and `ctx.ui.custom`.
- `docs/rendering.md` — UI components render on every frame; rendered lines must be cached and session scans must happen outside `render()`.
- `src/extensions/tasks-view/index.ts` — existing extension shows a widget and clears it on input; useful precedent, but its contents are process-local jobs rather than a current-task checklist.
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/plan-mode/index.ts` and `utils.ts` — Pi ships an optional example extension that extracts numbered steps from an assistant `Plan:` section and manages them in its own state. It is not registered by hd-agent's `package.json`; it does not establish a general plan/current-task API.
- `README.md` — advertises a `todo` tool with a live UI-footer widget, but matching implementation was not found in `src/extensions`; treat this README claim as unverified/stale until separately resolved.
- Pi type declarations in `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` — widgets support above/below-editor placement; `ctx.ui.custom()` supports overlays. Pi does not provide an automatic collapsible widget control.

## Existing Contracts and Patterns
- Current-task state should follow the active session branch, not a process-global singleton.
- Compact summary answers "what is the agent doing, and what is likely next?" and stays visible near the composer regardless of transcript scroll position.
- Checklist item text should stay in the conversation language; generated UI labels should follow the conversation language when identifiable.
- Existing task-view extension provides a simple widget pattern; custom components must follow `docs/rendering.md`.

## Constraints
- Technical: Preserve Pi's current footer and editor behavior; avoid scanning session history in render callbacks; handle session start/tree changes and task updates.
- Operations: Must degrade gracefully when no active checklist exists; detail view should close cleanly and compact mode should remain usable in narrow terminals.
- Security/data: Summary is derived from current session context; avoid storing duplicate or sensitive transcript content unnecessarily.
- UI standard: No project-specific UI standard was found in the inspected project instructions; follow existing Pi TUI conventions.

## Comparative Research
- Devin's docs/release notes describe a Progress task drawer that can filter the activity stream by selected task. This could improve traceability, but needs task-to-tool-activity attribution.
- Claude Code documents a keyboard shortcut to toggle the task checklist, supporting a fast hide/show interaction.
- OpenCode documents an agent todo tool and permission controls; Codex documents plan and permission commands. These are adjacent workflow features, not a reason to expand this UI task into execution-policy changes.
- Devin's guidance recommends verifiable checkpoints and clear success criteria; use this as a quality bar for checklist item wording, not a separate implementation feature.

## Facts, Assumptions, Questions
- Verified: Pi API supports persistent widgets and custom overlays; the current repo has a widget precedent.
- Verified: Pi package contains optional todo and plan-mode examples; hd-agent does not register plan-mode in its package config.
- Verified: Repo already has `/tasks` for background jobs and `read_session` for session summaries; it has no current-task checklist or task-filtered activity stream.
- Verified from user clarification: User wants a concise summary of the agent's own work/current process and likely next action, not a background jobs rollup or necessarily a full checklist.
- Verified from user clarification: Display as short bullets; keep wording brief and in the conversation language.
- Verified from user clarification: Summary may be approximate; do not require precise done/not-done tracking.
- Open: Which session events/context should trigger deterministic summary refresh, balancing freshness against unnecessary UI churn?
- Open: What exact structured signal produced the task/progress lines shown in the user's screenshot? The Pi plan-mode example is a possible source only when enabled, but does not match every shown label by convention.
- Open: Which interaction is best supported for expanding the widget (keyboard shortcut/command versus clickable control)?
- Open: Can Pi safely register a non-conflicting shortcut for show/hide, or should v1 provide a command only?

## Clarifications
- User selected a compact persistent summary with an expandable detailed view; right-side popup is acceptable if it does not crowd narrow terminals.
- User emphasized a persistent current-task/topic summary near the chat composer, useful when returning to a long conversation or switching between tasks.
- User requested that checklist wording follow the language used in the conversation rather than defaulting to English.
