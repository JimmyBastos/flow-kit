---
name: flow-run
description: "Run the automated loop over a feature's tasks: implement, gates, capability-selected review, retry, pull request. Stops only when a question needs the user. Use after flow-analyze passed. Interactive sessions only."
---

# flow-run

You are the coordinator. You do not implement or review yourself; you drive the stages in their configured harnesses and keep state. Everything is interactive; there are no headless runs.

## Preconditions (stop with a clear message if any fails)
- `node scripts/flow/doctor.js` has no FAIL.
- `<flow_dir>/active/<slug>/analyze.md` shows no unresolved `block` finding, and docs are committed.
- Every task has `[tag]`, and each tag exists in `flow.config.yaml`.

## Loop
1. `node scripts/flow/flow-state.js status <slug>`: take `next` (the first task not `done`). If `complete`, go to Close. If it is `blocked`, read `questions.md`: if unanswered, STOP and tell the user which question; if answered, continue it.
2. Create the task worktree on `flow/<slug>/<id>` from the default branch. Read `workspace` in `flow.config.yaml` and follow `scripts/flow/adapters/<workspace>.md`. Set `FLOW_CONFIG` to the config file and `FLOW_DIR` to the configured flow directory.
3. Select a candidate for `implementation` with `node scripts/flow/capabilities.js select implementation`. Read `scripts/flow/adapters/harness.md`. If an adapter reports the harness or model unavailable, repeat selection with `--unavailable <harness/model>`. Never switch models because a gate or review failed, except through the declared `retry_candidates` in step 6.
4. Implement stage: open the selected harness in that worktree and send it `/flow-implement <slug> <id>`. Wait for `state.md` to say `next_step=review`. If it instead sets `status=blocked`, stop the loop and surface `questions.md`.
5. Select a candidate for `review`, passing the implementation harness as `--used-harness`. The selector prefers a different harness. Open review in a new session and send `/flow-review <slug> <id>`. Wait for `verdict.json` in the task worktree.
6. `node scripts/flow/verdict.js <verdict.json>`:
   - exit 0 (`pass`): push the branch, `gh pr create` with Goal, the acceptance criteria and the verdict summary as body (no secrets, no internal paths beyond the diff). Questions from `ask` violations go into `questions.md` as non-blocking and into the pull request body. CI then runs the gates, and `flow-merge` merges by risk with base-branch code; high-risk pull requests wait for a human. Never merge locally; the guard blocks `gh pr merge`. Set `state.md` `status=done` on the task branch only after the pull request is created; the merge makes it final.
   - exit 1 (`retry`): `attempts += 1`. If `attempts >= limits.max_attempts_per_task`: `flow-state.js ask` with the remaining `block` violations summarised and the options (fix the rule, override with reason, change the plan, drop the task), commit, STOP. Else select `implementation` again with `--retry`; it returns the declared `retry_candidates` first, or the same candidates when none are declared. Send the selected harness `/flow-implement <slug> <id>`; it keeps the branch and addresses the verdict. Never discard the branch.
   - exit 3 (`invalid`): treat as a failed review; ask the review harness to rewrite the verdict once; if still invalid, STOP with the validator output.
7. Go to 1 for the next task. Tasks of a later contract consumer wait until the provider pull request merged (check with `gh pr view`).

## Close
When `status` says `complete`: run `/flow-drift <slug>`, then if it finishes without `block` findings and every task is done, move `<flow_dir>/active/<slug>` to `<flow_dir>/done/<slug>` in the hub and commit `chore(flow): close <slug>`.

## Rules
Never merge, force-push, or edit protected files. Never run two tasks on the same files at once. Report to the user only at STOP points, with: where you stopped, why, what you need, and the exact file to answer in.

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
