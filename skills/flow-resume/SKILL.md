---
name: flow-resume
description: Load a task's state from the repo so any harness can continue it after a context clear, compaction, limit reset, or harness switch. Always the first command in a fresh session on a flow/* branch.
---

# flow-resume

State lives in the repo, not in the session. Read it to get the context back, then continue; do not ask the user to re-explain.

1. Identify the task: the branch must be `flow/<slug>/<id>` (else ask which task). In `multi` topology use `FLOW_ROOT=<hub>` for state.
2. Read `.flow/active/<slug>/tasks/<id>/state.md` (task, status, branch, last_commit, steps_done, next_step, next_harness, attempts), `questions.md` if present, and `verdict.json` if present.
3. Read the task block in `tasks.md`, the `plan-<tag>.md` it belongs to, the spec's success criteria it cites.
4. Compare reality with state: `git log --oneline <default>..HEAD`, `git status`, `git diff --stat <default>...HEAD`. If HEAD differs from `last_commit`, trust git, then correct `state.md`.
5. If `questions.md` has an unanswered `answer:` and the status is `blocked`: stop and tell the user exactly which question is waiting. If answered: apply the answer, set `status=in_progress`, commit, continue.
6. Summarise in 5 lines: task, what is done, what is next, last verdict (if any), blockers. Then continue with `next_step`, using `/flow-implement` rules (or `/flow-review` if `next_step` is review and you are in the review harness).

If `next_harness` names a different harness than the one you are in, say so: the next step is meant for that harness (the review runs in its own session).
