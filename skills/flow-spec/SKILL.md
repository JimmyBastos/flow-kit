---
name: flow-spec
description: Write the feature spec (what and why, about 60 lines) from research.md and get user approval. Use after flow-research, before flow-plan.
---

# flow-spec

Input: `<flow_dir>/active/<slug>/research.md`. Output: `<flow_dir>/active/<slug>/spec.md` from `templates/spec.md`.

## Procedure
1. Read `research.md`, `AGENTS.md`, `docs/rules/index.md`. If `research.md` has open questions that affect scope, go back to `/flow-research`.
2. Write the spec. Sections: Goal, Problem, Context, Scope, Not included, Success criteria. Success criteria are numbered `SC-n`, each observable and testable by someone who has not read the code. List the targets (tags from `flow.config.yaml`) the feature touches in the header.
3. **No how.** No file paths, no libraries, no schema. Those belong to the plan. Reference rules by id; never copy them.
4. **Size.** Hard cap `limits.max_spec_lines`. Check with `node scripts/flow/gates.js size --feature <slug>`. If it does not fit, the feature is too big: split it into two slugs and say so. Never compress to fit.
5. **Approval gate (blocking).** Show the spec to the user and ask: approve, edit, or split. Record `Status: approved` only after an explicit yes. Commit: `docs(flow): spec <slug>`.

Next: `/flow-plan <slug>`.

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
