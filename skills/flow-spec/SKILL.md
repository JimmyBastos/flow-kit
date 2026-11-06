---
name: flow-spec
description: Interactive. Research a feature with the user and write its spec (what and why, success criteria). The only step that creates or changes a spec. Use to start a feature, or with --amend to change an approved one.
---

# flow-spec

Run in the hub repo (the one with `.flow/flow.json`), with the user. Output: `.flow/<feature>/spec.md`, about 40 lines.

## Steps
1. **Ask for existing material first:** diagrams, exports, notes, earlier specs, tracker items. Read what the user gives, plus `.flow/*/spec.md`, `docs/adr/` and `docs/rules/` in the repos listed in `.flow/flow.json`. Use subagents (a small model) for code reading.
2. **Check every path you cite** by opening it. Never cite from memory.
3. **One round of questions.** Ask everything that changes the shape of the work (inputs, names, scope, data, success criteria) in a single round of at most 4 questions per batch, each with your recommended answer and why. "Go with your recommendations" is a valid answer. Never ask what the code or the docs answer.
4. **Challenge:** if the idea duplicates something, conflicts with a rule, or is bigger than one spec, say so and propose a split.
5. **Write the spec** in this format. No file paths, libraries or schema; those are the plan's.
   ```
   ---
   after: [<feature>, ...]   optional: plan only once every task of these features is merged
   ---
   # <Feature title>
   Repos: <tags from flow.json>
   ## Goal        one sentence
   ## Problem     what is wrong today, for whom
   ## Scope       bullets
   ## Not included  bullets
   ## Success criteria
   - SC-1: <observable, testable by someone who has not read the code>
   ```
6. **A decision that governs future features** goes in `docs/adr/NNNN-<slug>.md` (Context, Decision, Consequences, at most about 20 lines). Ask before adding one.
7. **Approval.** Show the spec. On the user's explicit yes, commit `docs(flow): spec <feature>` and push to the default branch. The orchestrator plans it on its next tick.

`--quick "<text>"`: for a small task, write a spec with Goal and 1–3 success criteria, one confirmation question, then commit.

Ask only when the answer changes the spec and the material the user gave, the ADRs and the code do not answer it. Otherwise take the most reasonable option and state it in the spec.

`--amend <feature>`: edit only what the user changes, show the diff, commit on yes. The plan's `spec_sha` no longer matches, so no new task of this feature starts until the orchestrator re-plans it.
