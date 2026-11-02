---
name: flow-analyze
description: Read-only consistency check across a feature's spec, plans, tasks and tracker, with findings classified by severity. Use after flow-tasks and before flow-sync or flow-run, and any time a feature has been in flight for a while.
---

# flow-analyze

Read-only. Never fix anything; report. Output: a findings table in the chat and `<flow_dir>/active/<slug>/analyze.md` (overwritten each run). Use `planning`; request `repository_exploration` only to verify target facts.

## Mechanical checks first (run them, do not check by reading)
- `node scripts/flow/gates.js size --feature <slug>` (spec and plan caps).
- `node scripts/flow/gates.js text --feature <slug>` (sentences over 25 words, figurative or vague words). Report each hit as a `format` finding. A hit in a word list can be a false alarm, so read the sentence before you report it.
- Parse `tasks.md`: count tasks, check each has Goal, Context, Acceptance criteria and a `[tag]` that exists in `flow.config.yaml`.
- Grep ticket-facing sections for paths (`/`, `.ts`, `.py`...), line numbers (`:123`, `line 12`) and estimates.

## Semantic checks
| Category | Check |
|---|---|
| `coverage` | Every `SC-n` is covered by at least one task acceptance criterion |
| `not_included` | Nothing in plans or tasks implements something the spec lists under Not included |
| `contract` | Each cross-target contract is identical in both plans; providers precede consumers in task order |
| `scope` | Tasks or plans mention behaviour the spec does not ask for |
| `format` | Missing sections, wrong headings, size caps, ticket text rules |
| `tracker` | If a tracker is configured: every task has an issue, and tracker status and text agree with `tasks.md` (the docs are the source; report tracker-only edits, never pull them in) |

## Severity
Classify each finding with `approvals.analyze` in `flow.config.yaml`: category in `block` stops the flow; in `ask` becomes a non-blocking question; in `log` is recorded only. An unknown category counts as `block`. Use `classify()` from `scripts/flow/verdict.js` logic if in doubt.

## Output
Findings table: severity | category | where | what | suggested fix. Then the decision: any `block` means STOP and ask the user how to resolve each (they pick the fix; you apply it to the docs after they decide, then re-run). Only `ask`/`log` findings: show them, record them, and continue. No findings: say "analyze passed" and the next step (`/flow-sync <slug>` if a tracker is configured, else `/flow-run <slug>`).

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
