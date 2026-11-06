---
name: flow-plan
description: Headless. Turn an approved spec into one short plan per repo and one short file per task. Started by the orchestrator through flow.js launch; never by hand. Never changes the spec.
---

# flow-plan

You run headless in a worktree of the hub repo on branch `flow/<feature>/plan`. Arguments: the feature and the PR body file. Input: `.flow/<feature>/spec.md`. You must not edit the spec. If it cannot be planned as written, stop and return a question.

## Steps
1. Read the spec, `docs/adr/`, and for each repo it lists, that repo's `AGENTS.md` and `docs/rules/index.md`. Read the real code the feature touches. Use subagents (a small model) for code reading, one per repo, and ask them for `path:line` evidence only.
2. **Write `.flow/<feature>/plan-<repo>.md`** for each repo, at most about 60 lines:
   ```
   ---
   spec_sha: <output of: git hash-object .flow/<feature>/spec.md>
   ---
   # Plan: <feature> in <repo>
   ## Approach      how, reusing named existing patterns
   ## Contracts     every cross-repo interface, word for word the same in both plans; provider and consumer
   ## Risks
   ## Tasks         one line each: NN [repo] title (depends: NN)
   ```
3. **Write `.flow/<feature>/tasks/NN-<slug>.md`** for each task, at most about 40 lines. A task is one PR and one session. Split at points where the build still passes: schema before use, provider before consumer. Add `depends` only where tasks touch the same code or contract, so the rest can run in parallel. **complexity** picks the model: `low` follows an existing pattern in one module, with no migration, contract, security or tenancy logic; `high` changes a schema, a migration, tenancy, a cross-repo contract or concurrency; otherwise `medium`.
   ```
   ---
   repo: <tag>
   depends: [NN, ...]
   complexity: low | medium | high
   ---
   # NN <imperative title>
   ## Goal                 one sentence, product language
   ## Context              why now, what it builds on
   ## Acceptance criteria  - <observable result> [SC-n]
   ## Notes                implementation pointers: paths, patterns, commands
   ```
4. **Self-check:** every `SC-n` is cited by a task; nothing from Not included is built; no scope beyond the spec; contracts match in both plans; no file over its size (split instead).
5. Commit `docs(flow): plan <feature>`. Write 3–5 lines to the PR body file: what the plan covers and how many tasks. Do not push; `flow.js` does.
6. **Commands:** one command per Bash call, run from the current directory: no pipes, `&&`, `;` or `git -C`. Read files with the Read tool; list them with `git ls-files`, search with `git grep`. A denied command is expected, not a blocker: use one of these allowed ways and continue.

## Finish
Your last message is exactly one JSON object:
`{"status":"done","summary":"<one sentence>"}` or `{"status":"question","question":"…","options":["…","…"],"recommended":"…"}`.
