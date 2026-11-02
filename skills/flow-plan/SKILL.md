---
name: flow-plan
description: Write one plan per target (how to build the approved spec), cross-check the contracts between targets, and get user approval. Use after the spec is approved.
---

# flow-plan

Input: approved `spec.md`. Output: `<flow_dir>/active/<slug>/plan-<tag>.md` for each target the spec lists (template: `templates/plan.md`).

Use `repository_exploration` to inspect each target. Use `planning` to draft and cross-check plans. Do not choose models in this skill.

## Procedure
1. Refuse if the spec is not `Status: approved`.
2. For each target, read the real code first (the code is the source of truth, not memory): entry points, the modules the feature will touch, existing patterns to reuse (cite them with paths), `docs/rules/` for that target.
3. Write the plan: Approach, Contracts, Changes, Risks. Reference rules by id (`R-012`); never copy them. Every `SC-n` in the spec must be addressed by at least one plan.
4. **Contracts.** Every interface that crosses targets (HTTP/RPC endpoints, events, shared types, schema) is written word for word in BOTH plans. Name provider and consumer. After drafting, compare the two copies line by line and fix any difference before showing the user. Prefer generating from a machine-readable source (OpenAPI, types) when the stack has one; say which.
5. **Size.** Cap `limits.max_plan_lines` per plan; check with `gates.js size`. Over the cap means the feature or the plan is too big. Split; never compress.
6. **Decisions.** Keep feature-only decisions in the plan. Put decisions that should govern future features in `<flow_dir>/decisions/`, using `templates/decision.md`. Use short Context, Decision, and Consequences sections. Add Alternatives only when they matter. Do not create duplicate decision records.
7. **Approval gate (blocking).** Show all plans and any proposed decision records together with the contract table. The user approves, edits, or sends you back. Commit: `docs(flow): plan <slug>`.

Next: `/flow-tasks <slug>`.

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
