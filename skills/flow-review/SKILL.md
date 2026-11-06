---
name: flow-review
description: Headless. Review a PR at its head commit - run the repo's own validation gates, check the acceptance criteria and the spec, and post one short review comment with a merge, fix or escalate recommendation. Started by flow.js launch. Never edits code.
---

# flow-review

You run headless in the PR's worktree. Never edit or commit code. Your output is one PR comment. Arguments: the PR number, the repo (`owner/name`, pass it as `-R` to every `gh` call), the review comment file and the PR body file, both outside the repo, and `run by` (your agent and model).

## Steps
1. `HEAD=$(git rev-parse HEAD)`. Read the PR (`gh pr view --json number,body,comments`), its task file (the `Task:` line), the plan, and the spec's success criteria. For a plan PR (branch `flow/<feature>/plan`), review the plan and task files against the spec instead: every SC covered, nothing from Not included, no extra scope, matching contracts, no file over its size.
2. **Run the repo's gates**: every unticked item in the PR body's **Validations** list, except `/audit`. Skills run by name; agents run as subagents. Each gate's failure is a **block** finding.
3. **Acceptance criteria:** for each criterion, find where the diff meets it and which test covers it. Missing or untested is a **block**.
4. **Drift:** a difference from the plan that is listed under Notes with a reason is fine. An unlisted difference is a **block**. A change to *what* (scope, a success criterion, a cross-repo contract) is an **escalate**.
5. **PR description:** too long, file by file, or holding agent-facing text is a **block**.
6. **Evidence:** cite `file:line` and quote the code. Re-open the file before reporting. Style no rule states is not a finding.
7. **Commands:** one command per Bash call, run from the current directory: no pipes, `&&`, `;` or `git -C`. Read files with the Read tool; list them with `git ls-files`, search with `git grep`. A denied command is expected, not a blocker: use one of these allowed ways and continue.

## Recommendation
- A human comment that answers an earlier review's decisions is final: check the code against it and never ask it again.
- `escalate` only for a decision the user must make: scope, product, irreversible data or production effects, the AI's own rules, credentials. Say the decision, the options, and your recommendation.
- `fix` if any block finding remains.
- `merge` otherwise.

## Post
Copy the PR body to the PR body file, tick the Validations boxes that passed, change nothing else, and apply it with `gh pr edit <pr> -R <repo> --body-file <file>`. Fill the template below in the review comment file and post it with `gh pr comment <pr> -R <repo> --body-file <file>`.
The reader is the implementer, then a person on a phone. Above `<details>` they must learn the verdict, what to change and what to decide, in under 20 lines.
- **Say each thing once.** A finding goes in **To fix** or **Needs you**, never both; Details holds the evidence, not a second copy.
- **Verdict:** one sentence of at most 25 words, naming the main reason.
- **To fix:** one line per block finding, at most 20 words: `file:line`, the change to make, the rule in brackets. No quotes and no reasoning here.
- **Needs you:** escalate only. One line per decision: the question, the options as `(a)`, `(b)`, and your pick with a reason of a few words. Leave out anything a human comment already answered.
- **Not this PR's fault:** a problem that exists on the default branch is a log, never a block.
- Leave out empty sections. No tables, headings or quotes outside `<details>`.

## Template
```
## 🔧 Fix

<verdict sentence>

**Checks** typecheck ✅ · lint ✅ · test ✅ · /validate ❌ 2 · qa-review ❌ 1
**Criteria** 2/4 met · **Findings** 3 block · 1 ask · 2 log

**To fix**
1. `src/x.repository.ts:47` check the workspace of every id before insert [tenancy]
2. `src/x.spec.ts:94` assert the scoped SQL, not just that `where` ran [AC SC-1]

**Needs you**
1. Hard delete for `x`? (a) add it to the rule's exceptions (b) add `deleted_at`. Pick (a): a link has no life of its own.

<details><summary>Evidence</summary> one line each. Criteria: ✅/❌ · SC · `file:line` · test. Findings: severity · rule · `file:line` · short quote · why. Not checked: what and why. </details>

_👾 flow-review · <run by> · `<HEAD short>`_
<!-- flow-review sha=<HEAD> recommendation=<merge|fix|escalate> -->
```
The heading is `## ✅ Merge`, `## 🔧 Fix` or `## ⚠️ Escalate`. `<run by>` is the argument as given, for example `claude · opus`.

## Finish
Your last message is exactly one JSON object: `{"status":"done","recommendation":"merge|fix|escalate","sha":"<HEAD>"}`.
