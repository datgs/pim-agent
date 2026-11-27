---
status: proposed
last_reviewed: 2026-11-23
superseded_by: []
related_code:
  - src/extensions/tasks-view/index.ts
  - docs/pi-api.md
  - docs/rendering.md
---

# Approach: Current Task Checklist

## Recommendation
Show a persistent, very short activity summary of what the agent is working on and what it may do next. Render it as a small bullet list near the composer, in the user's conversation language. Use structured plan/context when available; otherwise derive a deterministic summary from the latest user request and explicit agent progress signals at meaningful milestones. Do not list every tool call or background job, and do not claim precise completion status unless the source provides it. Do not make a separate LLM call for summaries in v1. If there is not enough signal for a next step, show only the current topic. Refresh at task/plan changes and other meaningful milestones, not after every tool call. An optional command can open fuller context in a right-side overlay; on narrow terminals, use a centered/custom dialog or full-width view.

This keeps the user's focus visible without adding noisy messages to the chat.

## UI Sketch
Compact activity summary beside/above the composer:

```text
┌─ Activity ──────────────────────────────────────────────────────────┐
│ • Đang xác định nguồn Activity trong Pi                             │
│ • Tiếp theo: chốt cách cập nhật summary                             │
└────────────────────────────────────────────────────────────────────┘
> Guide Devin while it works
```

When no plan exists, show a concise summary of the current task and likely next step, based on the conversation:

```text
┌─ Activity ──────────────────────────────────────────────────────────┐
│ • Đang phân tích yêu cầu và chọn hướng giải quyết                   │
│ • Tiếp theo: bắt đầu triển khai                                     │
└────────────────────────────────────────────────────────────────────┘
> _
```

Optional expanded detail may show the current plan/context, but a full activity browser is not required in v1. On narrow terminals, use a centered or full-width overlay rather than squeezing the chat.

## Related Ideas from Other Agents
- **Plan/approval mode** — OpenCode and Codex expose separate plan and permission workflows. This changes execution policy and remains outside this activity-summary feature.

## Meaningful Alternatives
- Repeated summary messages in chat — not chosen because they add noise and bury conversation.
- Compact activity summary near the composer — recommended; short bullets remain visible when returning to a long session.
- Full activity browser — deferred; broader than the requested summary.

## Contracts and Integration
- Inputs: Current conversation/task context, structured plan when available, and meaningful task/plan changes.
- Outputs: Persistent compact bullet summary of current work and likely next step, in conversation language. V1 does not require a full checklist or detailed activity feed.
- Compatibility: Do not modify Pi's session history or add a parallel todo tool/data model. No external persistence. Do not replace the built-in footer.

## Risk and Evidence
| Area | Risk | Evidence or validation |
|---|---|---|
| Summary accuracy | Medium | Structured plan anchors the summary when available; deterministic no-plan fallback may be less polished, so omit unsupported next-step claims |
| UI space | Low | Pi supports above/below-editor widget and custom overlays; adapt overlay to terminal width |
| Performance | Low | Cache rendered lines and update state from events, per `docs/rendering.md` |
| Session branching | Medium | Rebuild from active branch/session events and test after tree navigation/fork |

## Migration, Operations, and Rollback
- Migration: None.
- Observability: No separate telemetry. UI state should be directly inspectable via command and session history.
- Rollback: Remove/disable the activity summary widget; no session data migration.

## Accepted Assumptions
- The goal is an activity summary, not a complete checklist or background-job dashboard.
- Show current work and a next step only when explicitly supported; do not claim exact completion status.
- V1 makes no separate LLM call for summary generation.
- Use the conversation language and keep the summary near the composer.
- Refresh at meaningful milestones, not after every tool call.
