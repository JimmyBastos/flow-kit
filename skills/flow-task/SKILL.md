---
name: flow-task
description: Headless. Implement or fix exactly one task in its worktree, commit, and write the PR description. Started by flow.js launch; never by hand. Never pushes.
---

# flow-task

You run headless in the task's worktree, on branch `flow/<feature>/<NN>`. `flow.js` has already merged the default branch in. Arguments: the task file, the mode (`implement` or `fix`), the PR body file, and `run by` (your agent and model).

## Before coding
1. Read the task file, the repo's `plan-<repo>.md` next to it, the spec's success criteria the task cites, the repo's `AGENTS.md`, and the `docs/rules/` files whose globs match what you will touch.
2. If a PR exists (`gh pr view --json number,body,comments`), read every comment. Answers to your questions and review findings are there.
3. If `git status` shows merge conflicts, resolve them first. Keep both sides' intent, and rerun the tests.

## Work
- Do the task and only the task. Follow the existing patterns. Commit each step with a conventional message.
- Run the repo's checks (from `AGENTS.md` or `.agents/skills/validate/checklist.md`) before you finish. You may fix anything in this repo that the checks need, including formatting and generated files.
- **A failing test is never "not mine".** Find where it broke and why, then fix the cause. Never skip, delete or weaken a test to get green. If you cannot tell whether the test or the code is wrong, ask.
- **Ask only when the answer changes scope, a success criterion, or a product choice** the spec and plan do not decide. Otherwise take the most reasonable option and record it as a decision.
- Never push, never edit `.flow/`, `.claude/` or settings, and never save memories.
- **Commands:** one command per Bash call, run from the current directory: no pipes, `&&`, `;` or `git -C`. Read files with the Read tool; list them with `git ls-files`, search with `git grep`. A denied command is expected, not a blocker: use one of these allowed ways and continue.

## Fix mode
Read the latest review comment and every human comment after it; a human decision is final. Address every **block** finding. To prove a bug first, `test-author` may write the failing test. When done, post **one** comment for the whole round with `gh pr comment`, one line per finding, in the review's order:
```
**Fixes in `<sha7>`**
1. Fixed: <what changed, at most 20 words>
2. Not changed: <reason with evidence>
<sub><i>🤖 flow-task · <run by> · `<sha7>`</i></sub>
```

## PR description
Write the **PR body file** from the arguments (it is outside the repo; never commit it). Use the repo's `.github/PULL_REQUEST_TEMPLATE.md`, written for people, about 15–20 lines in total:
- **What:** at most 5 capability bullets. Never a list of files or changes.
- **Why:** at most 3 sentences.
- **Notes:** only a deploy step, a migration, or a decision taken, as plain sentences. Omit it if empty.
- Leave the Validations boxes unticked; the reviewer ticks them.
- No status, no "needs a human", no agent instructions, no kit internals.
- The last line: `Task: .flow/<feature>/tasks/<file>` (the path inside the hub). Any attribution line goes above it.

## Finish
Your last message is exactly one JSON object:
- `{"status":"done","summary":"<one sentence>","decisions":["<only what differs from the task or plan, and why>"]}`; `decisions` is `[]` when nothing differs
- `{"status":"question","question":"…","options":["…","…"],"recommended":"…"}`
- `{"status":"failed","reason":"…"}`
