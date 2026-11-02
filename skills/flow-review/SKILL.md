---
name: flow-review
description: Review a task's diff with the configured review capability, preferring a harness different from implementation. Run machine gates, check rules and invariants, then write verdict.json. Never edit code.
---

# flow-review

Read-only on code. You write exactly one file: `.flow/active/<slug>/tasks/<id>/verdict.json` (schema: `schemas/verdict.schema.json`), inside the code worktree. This review artifact travels with the pull request so target CI can verify it. Shared state and decisions stay under `FLOW_DIR`. Review in a new session and prefer a different harness from implementation. If `state.md` shows this is the implementing session, stop and say so.

Use the `review` capability selected for the task.

## Step 0: run the gates first (they are fast and give the same result every time)
Run and capture, in order, stopping at the first failure:
1. `node scripts/flow/gates.js run --target <tag> [--e2e]` (include `--e2e` when the target has an `e2e` command)
2. `node scripts/flow/gates.js diff --base <default branch>`
3. For `Type: fix` tasks: `node scripts/flow/gates.js testfirst --base <default branch> --prove --target <tag>`. It needs a clean working tree, and it proves the test fails without the fix.
If any fails: verdict `fail` with one violation `rule: GATE`, `severity: block`, `why:` the failing command and its last output lines. Do NOT run the AI passes. Write the verdict and stop.

## Pass 1: acceptance and rules
Record `reviewed_commit=$(git rev-parse HEAD)` now. Read the diff against the default branch.
- For each acceptance criterion of the task: find where the diff (code and test) satisfies it. Missing or untested = violation `rule: SC-n`.
- If the diff deletes, skips, or weakens an existing test, find the reason in the commit message and the criteria. No reason, or a reason that does not match the cause = violation `rule: TEST`, `severity: block`. If you cannot tell whether the test or the code was wrong, use `ask`.
- Load only rule files matching the touched paths and only rules marked `enforce: review`. A violation needs the rule id, file and line, and the offending code quoted in `why`.

## Pass 2: invariants
Read `docs/rules/invariants.md`. For every changed file, ask how the change could break each relevant invariant (also through callers you must open), including paths no rule file matches. Same evidence bar.

## Evidence required (do not report what you cannot prove)
Before reporting any violation, re-open the file and confirm the line and the rule really conflict. If you cannot cite file:line and a quote, do not report it. Style opinions that no rule states are not violations.

## Severity
- `block`: breaks a rule, invariant, or acceptance criterion; or a security/data-loss risk.
- `ask`: you cannot decide from the docs (a judgment the user should make) but it does not block the merge.
- `log`: real but minor; recorded only.
`verdict` is `fail` iff any violation is `block`.

## Output
Write the JSON, validate it (`node scripts/flow/verdict.js <file>` must exit 0 or 1, never 3), and commit only that file: `chore(flow): review <slug>/<id> <pass|fail>`. Do not push; the implementer's runner or the user does. Update `state.md`: on pass `next_step="open pull request"`; on fail `next_step="fix block violations in verdict.json"`, and `next_harness=<implement harness>`. Print the verdict summary.
