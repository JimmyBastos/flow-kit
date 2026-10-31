---
name: flow-drift
description: Compare a feature's plans with the code that was actually built, classify each divergence by severity, ask only about the serious ones, and propose one-line doc fixes. Never edits code. Use after tasks land and before closing a feature.
---

# flow-drift

Never edit code. You may edit only `drift.md` and, after the user decides, the doc lines that the decisions made out of date.

1. **Extract claims** from each `plan-<tag>.md` that can be checked: contracts (endpoints, event names, field names and types), files/modules named, migrations, behaviours named in the Changes section.
2. **Check each claim against the real target code** (use a subagent per target for large plans). Record: claim, actual, evidence path:line. Verify against code on the default branch, not memory.
3. **Classify** every divergence with a category: `contradicts_spec` (breaks a spec success criterion or Not included), `new_behavior` (built something the plan did not say), `rename`, `refactor`, or another label you define. Severity comes from `approvals.drift` in `flow.config.yaml`; an unknown category is `block`.
4. **Act by severity.**
   - `log`: write the row in `drift.md` with Decision `logged`. Do not ask.
   - `ask`: write the row with Decision `pending`; ask the user in one batched, non-blocking question list at the end; the flow continues without waiting.
   - `block`: stop and ask the user per item: was it intended? Options: accept (update the doc), reject (open a fix task), or defer.
5. **Doc fixes.** For accepted divergences, show the user the one-line doc edit (plan or spec) as a diff and apply it only after approval. Never rewrite sections.
6. Never ask the same question twice: before asking, search `drift.md` for a decided row with the same claim.

Output: updated `drift.md` (columns in `templates/drift.md`) and a summary: counts per severity, items waiting on the user. Commit: `docs(flow): drift <slug>`.

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
