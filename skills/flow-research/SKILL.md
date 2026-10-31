---
name: flow-research
description: Gather context for a new idea and interview the user in rounds until the problem is clear, then write research.md and optionally a backlog entry. Use before flow-spec, when starting a feature or when the problem is still fuzzy.
---

# flow-research

Input: a slug and a rough idea. Output: `.flow/active/<slug>/research.md` (template: `templates/research.md`), or a line in `.flow/backlog.md` if the idea is real but not now.

## Procedure
1. **Look before asking.** Search the repos in `flow.config.yaml` for existing code, rules, ADRs, tracker issues and prior features (`.flow/done/`) that touch the idea. Note findings with file paths. Never ask a question the code or docs already answer.
2. **Interview in rounds.** Each round: at most 4 questions, each with a recommended answer and why, each one whose answer would change what gets built. Prefer multiple-choice. After each answer, update `research.md` and decide whether another round is needed. Stop when you could write a spec without guessing. Typical coverage: who is the user, what hurts today, what "done" looks like, what is explicitly out, constraints (deadline, compatibility, data), risks.
3. **Challenge.** If the idea duplicates something that exists, conflicts with a rule or invariant, or looks bigger than one spec (needs more than about 60 lines), say so and propose a split or a smaller first slice.
4. **Close.** Write a 3-line recommendation: build / defer / do not build. If defer, add a backlog entry (`slug | problem | why not now | trigger`) and stop. If build, tell the user to run `/flow-spec <slug>`.

Rules: this step is interactive by nature (the user's answers are the output). Do not invent answers. Do not write code. Mark every unresolved item under "Open questions"; flow-spec refuses to start with open questions that block scope.

## Writing
Follow the Writing section of `AGENTS.md`: plain words, named things, short complete sentences, the decision first.
