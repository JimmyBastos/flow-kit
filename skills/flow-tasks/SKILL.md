---
name: flow-tasks
description: Split approved plans into ordered tasks, each sized for one AI session and tagged by target. Use after flow-plan is approved. No user gate; flow-analyze checks the result.
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

Commit: `docs(flow): tasks <slug>`. Next: `/flow-analyze <slug>`. There is no user gate here, but nothing runs until analyze passes.

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
