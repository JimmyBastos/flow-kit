---
name: flow-run
description: Run the automated loop over a feature's tasks: implement, gates, cross-harness review, retry, pull request. Stops only when a question needs the user. Use after flow-analyze passed. Interactive sessions only.
---

# flow-run

You are the coordinator. You do not implement or review yourself; you drive the stages in their configured harnesses and keep state. Everything is interactive; there are no headless runs.

## Preconditions (stop with a clear message if any fails)
- `node scripts/flow/doctor.js` has no FAIL.
- `.flow/active/<slug>/analyze.md` shows no unresolved `block` finding, and docs are committed.
- Every task has `[tag]`, and each tag exists in `flow.config.yaml`.

## Loop
1. `node scripts/flow/flow-state.js status <slug>`: take `next` (the first task not `done`). If `complete`, go to Close. If it is `blocked`, read `questions.md`: if unanswered, STOP and tell the user which question; if answered, continue it.
2. Create the task worktree on `flow/<slug>/<id>` from the default branch. Read `workspace` in `flow.config.yaml` and follow `adapters/<workspace>.md` for the exact calls. For `multi`, also prepare a hub worktree and set `FLOW_ROOT`.
3. Implement stage: open the `stages.implement` harness in that worktree and send it `/flow-implement <slug> <id>`. Wait for `state.md` to say `next_step=review` (poll the file; use the `orchestration` skill's wait/ask primitives when available). If it instead sets `status=blocked`, STOP the loop and surface `questions.md`.
4. Review stage: open the `stages.review` harness in a new session (Claude models only in Claude Code) in the same worktree and send `/flow-review <slug> <id>`. If you cannot open a second session, STOP and tell the user to open it and run that command; this is the only manual step. Wait for `verdict.json` to appear in the task worktree (it is committed there, not in the hub).
5. `node scripts/flow/verdict.js <verdict.json>`:
   - exit 0 (`pass`): push the branch, `gh pr create` with Goal, the acceptance criteria and the verdict summary as body (no secrets, no internal paths beyond the diff). Questions from `ask` violations go into `questions.md` as non-blocking and into the pull request body. CI then runs the gates and the merge-by-risk job; high-risk pull requests wait for a human. Set `state.md` `status=done` on the task branch only after the pull request is created; the merge makes it final.
   - exit 1 (`retry`): `attempts += 1`. If `attempts >= limits.max_attempts_per_task`: `flow-state.js ask` with the remaining `block` violations summarised and the options (fix the rule, override with reason, change the plan, drop the task), commit, STOP. Else send the implement harness `/flow-implement <slug> <id>` again; it keeps the branch and addresses the verdict. Never discard the branch.
   - exit 3 (`invalid`): treat as a failed review; ask the review harness to rewrite the verdict once; if still invalid, STOP with the validator output.
6. Go to 1 for the next task. Tasks of a later contract consumer wait until the provider pull request merged (check with `gh pr view`).

## Close
When `status` says `complete`: run `/flow-drift <slug>`, then if it finishes without `block` findings and every task is done, `git mv .flow/active/<slug> .flow/done/<slug>` in the hub and commit `chore(flow): close <slug>`.

## Rules
Never merge, force-push, or edit protected files. Never run two tasks on the same files at once. Report to the user only at STOP points, with: where you stopped, why, what you need, and the exact file to answer in.

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
