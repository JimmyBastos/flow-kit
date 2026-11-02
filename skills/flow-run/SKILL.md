---
name: flow-run
description: "Deliver features to merged pull requests: implement, gates, capability-selected review, retry, pull request, one task after another. With no slug it works through queue.md feature by feature until the queue is done. Stops only when a question needs the user. Interactive sessions only."
---

# flow-run

You are the coordinator. You do not implement or review yourself; you drive the stages in their configured harnesses and keep state. Everything is interactive; there are no headless runs.

`/flow-run <slug>` runs one feature. `/flow-run` with no slug works through `<flow_dir>/queue.md`.

## Preconditions (stop with a clear message if any fails)
- `node scripts/flow/doctor.js` has no FAIL.
- For each feature you start: `spec.md` says `Status: approved`, `node scripts/flow/gates.js check --feature <slug>` passes, and the feature docs are committed.

## Queue
1. Before taking new work, check each `blocked` row. If its question is answered, or the pull request it waited for has merged, run `node scripts/flow/flow-state.js queue <slug> running`.
2. Run `node scripts/flow/flow-state.js queue` and take `next`. If `next` is null, report the queue and stop: rows done, rows blocked and why, rows waiting on a dependency, and rows still `draft`. Drafts need `/flow-intake`.
3. Run `flow-state.js queue <slug> running`, commit, and run the Loop for that slug.
4. When the feature closes, run `flow-state.js queue <slug> done`, commit, and go to step 1.
5. When the Loop stops on a question or on a pull request that waits for a human, run `flow-state.js queue <slug> blocked`, commit, and go to step 2. Features that depend on it wait. Other features continue.

## Loop
1. `node scripts/flow/flow-state.js status <slug>`: take `next` (the first task not `done`). If `complete`, go to Close. If it is `blocked`, read `questions.md`: if unanswered, stop this feature and name the question; if answered, continue it.
2. **Wait for earlier work.** Every earlier task of this feature must have its pull request merged before the next task starts, because each task branches from the default branch. Find each one with `gh pr list --head flow/<slug>/<id> --state all --json number,state,labels`. While CI runs, wait and check again every minute. A pull request labeled `needs-human-merge` stops this feature (Queue step 5).
3. Create the task worktree on `flow/<slug>/<id>` from the default branch. Read `workspace` in `flow.config.yaml` and follow `scripts/flow/adapters/<workspace>.md`. Set `FLOW_CONFIG` to the config file and `FLOW_DIR` to the configured flow directory.
4. Select a candidate for `implementation` with `node scripts/flow/capabilities.js select implementation`. Read `scripts/flow/adapters/harness.md`. If an adapter reports the harness or model unavailable, repeat selection with `--unavailable <harness/model>`. Never switch models because a gate or review failed, except through the declared `retry_candidates` in step 7.
5. Implement stage: open the selected harness in that worktree and send it `/flow-implement <slug> <id>`. Wait for `state.md` to say `next_step=review`. If it instead sets `status=blocked`, stop this feature and surface `questions.md`.
6. Select a candidate for `review`, passing the implementation harness as `--used-harness`. The selector prefers a different harness. Open review in a new session and send `/flow-review <slug> <id>`. Wait for `verdict.json` in the task worktree.
7. `node scripts/flow/verdict.js <verdict.json>`:
   - exit 0 (`pass`): push the branch, then `gh pr create` with Goal, the acceptance criteria and the verdict summary as body (no secrets, no internal paths beyond the diff). Questions from `ask` violations go into `questions.md` as non-blocking and into the pull request body. On the task branch, write `status=done` with `flow-state.js write`, then commit and push. CI runs the gates, and `flow-merge` merges by risk with base-branch code. High-risk pull requests wait for a human. Never merge locally; the guard blocks `gh pr merge`.
   - exit 1 (`retry`): `attempts += 1`. If `attempts >= limits.max_attempts_per_task`, run `flow-state.js ask` with the remaining `block` violations summarised and these options: fix the rule, override with reason, change the plan, drop the task. Commit and stop this feature. Otherwise select `implementation` again with `--retry`; it returns the declared `retry_candidates` first, or the same candidates when none are declared. Send the selected harness `/flow-implement <slug> <id>`; it keeps the branch and addresses the verdict. Never discard the branch.
   - exit 3 (`invalid`): treat it as a failed review. Ask the review harness to rewrite the verdict once; if it is still invalid, stop this feature with the validator output.
8. Go to 1 for the next task. Tasks of a contract consumer in another target also wait until the provider's pull request has merged.

## Close
When `status` says `complete` and every task's pull request has merged: run `/flow-drift <slug>`. If it finishes without `block` findings, move `<flow_dir>/active/<slug>` to `<flow_dir>/done/<slug>` in the hub and commit `chore(flow): close <slug>`.

## Rules
- Never merge, force-push, or edit protected files.
- Never run two tasks on the same files at once.
- Report to the user only when the queue stops. Say where each feature stopped, why, what you need, and the exact file to answer in.

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
