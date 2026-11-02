---
name: flow-research
description: Gather context for a new idea and interview the user in rounds until the problem is clear, then write research.md and optionally a backlog entry. Use before flow-spec, when starting a feature or when the problem is still fuzzy.
---

# flow-research

Input: a slug and a rough idea. Output: `<flow_dir>/active/<slug>/research.md` (template: `templates/research.md`), or a line in `<flow_dir>/backlog.md` if the idea is real but not now.

Use the `planning` capability to lead the interview. Use `repository_exploration` to inspect code, rules, decisions, and prior features. The config selects harness and model candidates for each capability.

## Procedure
1. **Look before asking.** Search the repos in `flow.config.yaml` for existing code, rules, decisions in `<flow_dir>/decisions/`, tracker issues and prior features (`<flow_dir>/done/`) that touch the idea. Note findings with file paths. Never ask a question the code or docs already answer.
2. **Grill the idea.** Build a small decision tree. Ask only questions whose answers change scope, success criteria, or a material trade-off. Ask the current set of answerable questions in rounds of at most 4. Give a recommended option and why. After every answer, update `research.md` and recompute the next questions. Do not ask facts that code or docs can answer.
3. **Challenge.** If the idea duplicates something that exists, conflicts with a rule or invariant, or looks bigger than one spec (needs more than about 60 lines), say so and propose a split or a smaller first slice.
4. **Close.** Record settled decisions and unresolved questions in `research.md`. Write a 3-line recommendation: build / defer / do not build. If defer, add a backlog entry using `templates/backlog.md`, rank by impact and urgency, respect dependencies and triggers, then stop. If build, tell the user to run `/flow-spec <slug>`.

Rules: this step is interactive by nature (the user's answers are the output). Do not invent answers. Do not write code. Stop asking when no unresolved decision can change the spec. Mark unresolved blockers under "Open questions"; flow-spec refuses to start with open questions that block scope.

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
