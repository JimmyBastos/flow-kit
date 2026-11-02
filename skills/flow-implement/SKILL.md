---
name: flow-implement
description: Implement exactly one task from tasks.md on its own branch, committing and updating state.md at every step, then hand off to review. Use inside a task worktree, normally started by flow-run or by the user with a task id.
---

# flow-implement

Input: slug and task id. You work in a worktree on branch `flow/<slug>/<id>`; if the branch does not exist create it from the default branch. Set `FLOW_CONFIG` and `FLOW_DIR` before calling scripts. In `multi`, `FLOW_DIR` points to the hub's configured flow folder.

Use the `implementation` capability (`--retry` when a previous verdict exists). A task may request another configured capability. Do not choose a model by skill name.

## Before coding
1. If this is not a brand-new task, run `/flow-resume` first and follow it.
2. Select the `implementation` capability using `node scripts/flow/capabilities.js select implementation`, adding `--retry` when `verdict.json` exists. Read the task, cited success criteria, target plan, and matching `docs/rules/` files.
3. `node scripts/flow/flow-state.js write <slug> <id> status=in_progress branch=flow/<slug>/<id> next_step="<first step>" next_harness=<review harness>`; commit it.

## Work loop (repeat per small step)
1. Do one small step that you can test. Follow existing patterns; cite none you did not read.
2. Run the target's gates for what you changed (`node scripts/flow/gates.js run --target <tag>`); fix failures before moving on. Passing the gates is not enough. You must also meet every acceptance criterion.
3. Commit with a conventional message, then update state: `flow-state.js write <slug> <id> steps_done=<comma list> next_step="<next>" last_commit=$(git rev-parse HEAD)`, and commit the state file with the step or right after it.

## Type: fix is test-first
First commit contains ONLY a test that fails for the reported reason (run it and show it failing). The next commit makes it pass. `gates.js testfirst --base <default branch>` enforces the order; a commit that mixes the failing test with the fix is rejected.

## When a gate or a test fails
A red test is never "not mine". Do not say it was already broken, do not skip it, do not delete it, and do not weaken it to get green. Find where it broke and why:
1. Run the failing test on the default branch (a clean worktree). This tells you if your change broke it or if it was red before.
2. Read the test, the code it covers, and `git log` for both. Find the cause in one sentence.
3. Act on the cause:
   - Your change broke it: fix your change.
   - The test is wrong or out of date, and the cause is clear: fix the test. The commit message says what was wrong and why.
   - It was already red on the default branch: the gates cannot pass until it is fixed, so fix it, in its own commit. If it does not fit in the diff limit, ask for a split.
   - You cannot tell whether the test or the code is wrong: `node scripts/flow/flow-state.js ask <slug> <id> "<what fails, what you checked>" --options "the test is wrong|the code is wrong"`, commit, and stop. Do not guess.

## Boundaries
- Only the task. A failing gate is part of the task (see above). If you find something else outside it (a bug, missing contract, rule conflict, ambiguity the plan does not cover), do not fix it: `node scripts/flow/flow-state.js ask <slug> <id> "<question>" --options "a|b"`, commit, and stop. The user answers in `questions.md`.
- Never touch the protected files (`flow.config.yaml`, `.github/`, `scripts/flow/`, `docs/rules/`, `.githooks/`). Never read secrets. Never force-push.
- Never mark the task done yourself. Done means the review passed and the pull request merged.
- Keep the code diff within `limits.max_task_diff_lines` (`gates.js diff`; test files do not count). If it will not fit, stop and ask for a split; do not shorten the code to make it fit.

## Finish
All acceptance criteria met and gates green: `flow-state.js write <slug> <id> next_step="review" next_harness=<review harness>`, commit, and say "ready for /flow-review". If a previous verdict exists (a retry), address each `block` violation specifically, and mention in the commit which violation ids you fixed.
