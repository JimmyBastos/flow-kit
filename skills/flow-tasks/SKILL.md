---
name: flow-tasks
description: Split approved plans into ordered tasks, each sized for one AI session and tagged by target, then run the mechanical feature check. Use after flow-plan is approved, or from flow-intake. No user gate.
---

# flow-tasks

Input: approved `spec.md` and `plan-*.md`. Output: `<flow_dir>/active/<slug>/tasks.md` (template: `templates/tasks.md`).

## Rules for tasks
- Format `### N. [tag] Imperative title`, then Goal, Context, Acceptance criteria, Type (`feature` or `fix`), Estimate.
- **One task = one session = about `limits.max_task_diff_lines` diff lines.** If you think it will not fit, split it. Split where the build still passes: schema before use, provider before consumer, a new behavior behind a flag before it is exposed.
- **Order is dependency order across targets.** A consumer task never precedes the provider task of the contract it consumes. Put the contract-defining task first.
- **Each acceptance criterion cites the success criterion it serves**, `[SC-n]`. Every `SC-n` must be covered by at least one task.
- **Ticket text describes the product, not the code**: Goal, Context and Acceptance criteria only. No file paths, no line numbers, no estimates in them (the Estimate line is local only).
- `Type: fix` tasks are test-first: the acceptance criteria start with the failing test that reproduces the bug.
- Do not put anything in a task that is not in the plans. If you discover a gap, stop and say which plan needs the change; do not work around it in the tasks.

## Check
Run `node scripts/flow/gates.js check --feature <slug>`. It checks size caps, that every `SC-n` is cited by a task, that each cited `SC-n` exists, the task fields and tags, and ticket text without paths, line numbers or estimates. Fix every problem it reports and run it again. A problem you cannot fix without changing the spec or a plan goes back to the user; do not work around it.

Commit: `docs(flow): tasks <slug>`. Next: `/flow-sync <slug>` if a tracker is configured, then `/flow-run <slug>`, or `/flow-run` for the whole queue. There is no user gate here, but nothing runs until the check passes.

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
