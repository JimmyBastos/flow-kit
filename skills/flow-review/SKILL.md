---
name: flow-review
description: Headless. Review a PR at its head commit - run the repo's own validation gates, check the acceptance criteria and the spec, and write one review - a short summary plus a comment on each issue's line - with a merge, fix or escalate recommendation. Started by flow.js launch. Never edits code.
---

# flow-review

You run headless in the PR's worktree. Never edit or commit code. You write files; `flow.js` posts them as one GitHub review, so the line comments stay grouped under the summary. Arguments: the PR number, the repo (`owner/name`, pass it as `-R` to every `gh` call), `review summary file`, `review line comments file`, `earlier line comments` (the line comments of earlier reviews), `review template file` (the summary layout), the PR body file (all outside the repo), and `run by` (your agent and model).

## Steps
1. `HEAD=$(git rev-parse HEAD)`. Read the PR (`gh pr view --json number,body,comments,reviews`), its task file (the `Task:` line), the plan, the spec's success criteria, and `gh pr diff`. For a plan PR (branch `flow/<feature>/plan`), review the plan and task files against the spec instead: every SC covered, nothing from Not included, no extra scope, matching contracts, no file over its size.
2. **Earlier reviews:** a first review is complete: report every finding in one pass. A later review is a delta: check each earlier issue and the fix comment's answers at HEAD (resolved, or still open). From the second review on, a new block is allowed only for a defect in lines changed since the last reviewed SHA, or a data, security or tenancy defect the earlier reviews did not raise; that one is **previously missed**. Anything else in code an earlier review saw is a note. A finding the fix answered is closed: do not reopen it with new wording. A human answer to an earlier decision is final: never ask it again.
3. **The whole, not the details:** review the change as part of the codebase: its callers, its modules, the data model, the plan. Block only on what breaks behavior, data, security, tenancy, a contract or a criterion; style and wording are notes. **Sweep:** for each block rule, `git grep` every place in the diff it touches, and list all of them in this review, so a later review finds nothing new under that rule.
4. **Run the repo's gates**: every unticked item in the PR body's **Validations** list, except `/audit`. Skills run by name; agents run as subagents. Each gate's failure is a block.
5. **Acceptance criteria:** for each criterion, find where the diff meets it and which test covers it. Missing or untested is a block.
6. **Drift:** a difference from the plan that is listed under Notes with a reason is fine. An unlisted difference is a block. A change to *what* (scope, a success criterion, a cross-repo contract) is an ask. A PR description too long, file by file, or holding agent-facing text is a block.
7. **Commands:** one command per Bash call, run from the current directory: no pipes, `&&`, `;` or `git -C`. Read files with the Read tool; list them with `git ls-files`, search with `git grep`. A denied command is expected, not a blocker.

## Severity and verdict
Each issue has one severity: **Block** (breaks behavior, data, security, tenancy, a contract or a criterion), **Ask** (a decision only the user can make: scope, product, irreversible data, the AI's own rules, credentials; say the options and your pick), **Recommended** (worth changing, does not block), **Note** (a problem on the default branch, or small).
- 🔴 Changes required: a Block remains. Recommendation `fix`.
- 🔍 Needs a closer look: an Ask remains and no Block. Recommendation `escalate`. Never ask what the spec, the plan, the code or an earlier decision answers.
- 🟡 Changes recommended: only Recommended issues. Recommendation `merge`.
- 🟢 Approval recommended: nothing open. Recommendation `merge`.

## Write
Copy the PR body to the PR body file, tick the Validations boxes that passed, change nothing else, and apply it with `gh pr edit <pr> -R <repo> --body-file <file>`.
**Line comments:** a JSON array `[{"path":"src/x.ts","line":47,"body":"…"}]` in `review line comments file`, one per new or previously missed issue whose line is in the diff, written for a person: `**🔴 Block** ·` then what is wrong and why it matters, what to change, and the convention as `docs/rules/<file>.md:<line>`. Quote the code only when it helps. An issue outside the diff has no line comment: its summary line is a `<details>` whose title is `severity · New · one-line description` and whose body holds the file link and the same detail. Earlier issues still open get none.
**Summary:** in `review summary file`, laid out as `review template file` (read it first; its lines are illustrations, write your own). Each issue link is `https://github.com/<repo>/blob/<HEAD>/<path>#L<line>`. Leave out an empty section. The heading matches the verdict. `<run by>` is the argument as given, for example `claude · opus`.
- Issues: one line each, `severity · New | Still open | Previously missed · description`, with the file link.
- Resolved, Checks, Criteria and Notes go in collapsed `<details>`.
- End with the attribution line and the `flow-review` marker, unchanged.

## Finish
Your last message is exactly one JSON object: `{"status":"done","recommendation":"merge|fix|escalate","sha":"<HEAD>"}`.
