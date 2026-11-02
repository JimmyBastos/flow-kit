---
name: flow-intake
description: Turn a list of requirements into ranked features that are ready to run. For each feature it investigates, writes the spec, plans and tasks, and runs the mechanical checks, then asks for one approval per feature in a single round. Use when you have several requirements, or one large one, and want /flow-run to deliver them without stopping.
---

# flow-intake

Input: requirements as pasted text, a file, or tracker issues. Output: rows in `<flow_dir>/queue.md` (template: `templates/queue.md`), and for each feature `<flow_dir>/active/<slug>/` with `spec.md`, `plan-<tag>.md` and `tasks.md`.

Use `research` to investigate and decide the split, and hand code reading to research subagents (`scripts/flow/adapters/harness.md`, Subagents). Use `planning` to write specs, plans and tasks. The config selects harness and model candidates.

## Procedure
1. **Look first.** Read `queue.md`, `backlog.md`, `active/`, `done/` and `decisions/` under `<flow_dir>`, and `docs/rules/`. If a requirement is already queued or done, skip it and say which row covers it.
2. **Split and merge.** One feature fits one spec within `limits.max_spec_lines`. Split a requirement that does not fit. Merge requirements that change the same behavior. Give each feature a short slug.
3. **Order.** Put a feature that provides a contract before the features that use it, then order by impact. Write each row as `draft`, with its `Depends on` slugs, using the table in `templates/queue.md`.
4. **Prepare each feature, in queue order, without asking yet:**
   - Investigate as `/flow-research` step 1 does. Collect only the questions whose answers change scope or success criteria. Write them in `research.md` with your recommended answer.
   - Write `spec.md` with the `/flow-spec` rules, the plans with the `/flow-plan` rules (including its self-check), and `tasks.md` with the `/flow-tasks` rules.
   - Run `node scripts/flow/gates.js check --feature <slug>` and fix every problem it reports.
5. **One approval round.** For each feature show: Goal, success criteria, targets, the plan approach and contracts, the number of tasks, and the open questions with your recommended answers. Ask at most 4 questions at a time. The user approves, edits, splits, drops, or answers each one. Apply the answers and edits, then run `gates.js check` again.
6. **Record.**
   - For each approved feature, set `Status: approved` in `spec.md` and run `node scripts/flow/flow-state.js queue <slug> approved`.
   - A feature the user defers leaves the queue and goes to `backlog.md` (`templates/backlog.md`).
   - A feature with an open question stays `draft`.
   - Commit: `docs(flow): intake <slugs>`.

Next: `/flow-run` works through the queue.

## Rules
- Do not invent answers. Do not write code.
- Never mark a feature `approved` without the user's explicit yes for that feature.
- If two features would change the same files at the same time, add a `Depends on` between them.

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
