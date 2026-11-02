---
name: flow-analyze
description: Read-only consistency check across a feature's spec, plans, tasks and tracker, with findings classified by severity. Use after flow-tasks and before flow-sync or flow-run, and any time a feature has been in flight for a while.
---

# flow-analyze

Read-only. Never fix anything; report. Output: a findings table in the chat and `<flow_dir>/active/<slug>/analyze.md` (overwritten each run). Use `planning`; request `repository_exploration` only to verify target facts.

## Mechanical checks first (run them, do not check by reading)
- `node scripts/flow/gates.js size --feature <slug>` (spec and plan caps).
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
Severity is fixed. `block` (stops the flow): `contract`, `coverage`, `not_included`. `ask` (a non-blocking question): `scope`. `log` (recorded only): `format`. Any other category counts as `block`.

## Output
Findings table: severity | category | where | what | suggested fix. Then the decision: any `block` means STOP and ask the user how to resolve each (they pick the fix; you apply it to the docs after they decide, then re-run). Only `ask`/`log` findings: show them, record them, and continue. No findings: say "analyze passed" and the next step (`/flow-sync <slug>` if a tracker is configured, else `/flow-run <slug>`).

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
