---
name: flow-plan
description: Write one plan per target (how to build the spec), check scope and the contracts between targets, and get one user approval for the spec and the plans together. Use after flow-spec, or from flow-intake.
---

# flow-plan

Input: `spec.md`. Output: `<flow_dir>/active/<slug>/plan-<tag>.md` for each target the spec lists (template: `templates/plan.md`).

Use `planning` to draft and cross-check plans. Hand code reading to research subagents, one per target (`scripts/flow/adapters/harness.md`, Subagents). Do not choose models in this skill.

## Procedure
1. Refuse if `spec.md` is missing, or if `research.md` has open questions that change scope.
2. For each target, read the real code first (the code is the source of truth, not memory): entry points, the modules the feature will touch, existing patterns to reuse (cite them with paths), `docs/rules/` for that target.
3. Write the plan: Approach, Contracts, Changes, Risks. Reference rules by id (`R-012`); never copy them. Every `SC-n` in the spec must be addressed by at least one plan.
4. **Contracts.** Every interface that crosses targets (HTTP/RPC endpoints, events, shared types, schema) is written word for word in BOTH plans. Name provider and consumer. Prefer generating from a machine-readable source (OpenAPI, types) when the stack has one; say which.
5. **Size.** Cap `limits.max_plan_lines` per plan; check with `gates.js size`. Over the cap means the feature or the plan is too big. Split; never compress.
6. **Decisions.** Keep feature-only decisions in the plan. Put decisions that should govern future features in `<flow_dir>/decisions/`, using `templates/decision.md`. Use short Context, Decision, and Consequences sections. Add Alternatives only when they matter. Do not create duplicate decision records.
7. **Self-check before showing anything.** Fix each problem, then check again:
   - `contract`: the two copies of each contract differ in any word, or a consumer would be built before its provider.
   - `not_included`: a plan builds something the spec lists under Not included.
   - `scope`: a plan adds behavior the spec does not ask for. Remove it, or ask the user to add it to the spec.
8. **Approval gate (blocking, one per feature).** Show the spec, all plans, the contract table, and any proposed decision records together. The user approves, edits, or sends you back. On an explicit yes, set `Status: approved` in `spec.md`. If `<flow_dir>/queue.md` has a row for the slug, run `node scripts/flow/flow-state.js queue <slug> approved`. Commit: `docs(flow): plan <slug>`. Inside `/flow-intake`, this gate happens in its single approval round.

Next: `/flow-tasks <slug>`.

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
