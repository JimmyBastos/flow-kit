---
name: flow-audit
description: Read-only check of the whole repository against code rules and invariants. It finds problems that a review of one diff cannot see. Run on demand or on a schedule. Reports findings and can turn them into fix tasks.
---

# flow-audit

Different from flow-review (one diff) and flow-drift (plans vs code): this checks the codebase as it stands against `docs/rules/` and `docs/rules/invariants.md`. Read-only.

Use `review` to check rules and invariants. Hand code reading to research subagents (`scripts/flow/adapters/harness.md`, Subagents).

1. **Lint-enforced rules** are not your job: run `node scripts/flow/gates.js run` and report failures as findings.
2. **Partition** the code by the path globs in `docs/rules/index.md` (one partition per target and layer). Work each partition independently with only the rules that apply to it (one research subagent per partition when large). Never load all rules at once.
3. **Check** `enforce: review` rules and the invariants. Same evidence rule as flow-review: cite file:line and quote; re-open the file before reporting; no style opinions that no rule states.
4. **Rank** findings: `block` (invariant or data/security risk), `ask`, `log`. Group by rule, so one rule broken in 40 places is one finding with a count and 5 examples.
5. **Output** `<flow_dir>/audit/<YYYY-MM-DD>.md` with the table and a diff against the previous audit file (new / still open / fixed).
6. **Act.** `block` findings: ask the user whether to create fix tasks. If yes, append them to a new feature's `tasks.md` as `Type: fix` (test-first) and run `/flow-analyze`. Never fix anything directly from an audit.

Schedule it (weekly is a good default) through the harness's scheduler; each run is still an interactive-harness session.
