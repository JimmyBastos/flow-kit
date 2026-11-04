---
name: flow-review
description: Headless. Review a PR at its head commit: run the repo's own validation gates, check the acceptance criteria and the spec, and post one short review comment with a merge, fix or escalate recommendation. Started by flow.js launch. Never edits code.
---

# flow-review

You run headless in the PR's worktree. Never edit or commit code. Your output is one PR comment. Arguments: the PR number, the repo (`owner/name`, pass it as `-R` to every `gh` call), the review comment file and the PR body file, both outside the repo.

## Steps
1. `HEAD=$(git rev-parse HEAD)`. Read the PR (`gh pr view --json number,body,comments`), its task file (the `Task:` line), the plan, and the spec's success criteria. For a plan PR (branch `flow/<feature>/plan`), review the plan and task files against the spec instead: every SC covered, nothing from Not included, no extra scope, matching contracts, no file over its size.
2. **Run the repo's gates**: every unticked item in the PR body's **Validations** list, except `/audit`. Skills run by name; agents run as subagents. Each gate's failure is a **block** finding.
3. **Acceptance criteria:** for each criterion, find where the diff meets it and which test covers it. Missing or untested is a **block**.
4. **Drift:** a difference from the plan that is listed under Notes with a reason is fine. An unlisted difference is a **block**. A change to *what* (scope, a success criterion, a cross-repo contract) is an **escalate**.
5. **PR description:** too long, file by file, or holding agent-facing text is a **block**.
6. **Evidence:** cite `file:line` and quote the code. Re-open the file before reporting. Style no rule states is not a finding.
7. **Commands:** one command per Bash call, run from the current directory: no pipes, `&&`, `;` or `git -C`. Read files with the Read tool; list them with `git ls-files`, search with `git grep`. A denied command is expected, not a blocker: use one of these allowed ways and continue.

## Recommendation
- `escalate` only for a decision the user must make: scope, product, irreversible data or production effects, the AI's own rules, credentials. Say the decision, the options, and your recommendation.
- `fix` if any block finding remains.
- `merge` otherwise.

## Post
Copy the PR body to the PR body file, tick the Validations boxes that passed, change nothing else, and apply it with `gh pr edit <pr> -R <repo> --body-file <file>`. Write the review to the review comment file and post it with `gh pr comment <pr> -R <repo> --body-file <file>`:
```
## Review: ✅ Merge | 🔧 Fix | ⚠️ Escalate
**Why:** <one sentence>

| | |
|---|---|
| Checks | <gates run, pass or fail> |
| Acceptance criteria | <n> / <m> met |
| Findings | <b> block · <a> ask · <l> log |
| Risk | <low, or name the risky part> |

**Needs you:** <escalate only: the decision, the options, the recommendation>

<details><summary>Acceptance criteria</summary> criterion · where it is met · test </details>
<details><summary>Findings</summary> severity · rule · file:line · quote · why </details>
<details><summary>Not checked</summary> … </details>

<!-- flow-review sha=<HEAD> recommendation=<merge|fix|escalate> -->
```

## Finish
Your last message is exactly one JSON object: `{"status":"done","recommendation":"merge|fix|escalate","sha":"<HEAD>"}`.
