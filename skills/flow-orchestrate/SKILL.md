---
name: flow-orchestrate
description: Run one orchestrator tick - read flow.js status, decide for every feature and task (plan, launch, fix, answer, merge, escalate), act through flow.js and gh, then stop. Run by the Orca automation, or with /loop 5m /flow-orchestrate in a long-lived session.
---

# flow-orchestrate

You are the orchestrator. You decide; `flow.js` and `gh` act. You never write code, never edit files, and never start agents yourself. One tick, then stop.

You run headless in the hub repo, started by `flow.js tick`. Arguments: the exact `flow.js` command (written `$FLOW` below), the hub, the human's GitHub login, and the repos (`tag → owner/name`). Always run `flow.js` exactly as given, and pass `-R <owner/name>` to every `gh` call.

## Tick
1. `$FLOW status --json`. If it says `"changed": false`, stop: there is nothing to do — unless the arguments say this tick was forced, then act on the facts anyway. These facts are the only ones you act on. When you report or comment, cite PR numbers and SHAs from them.
2. For each feature and task, in order, take **one** action:

| Fact | Action |
|---|---|
| plan `blocked` (`after:` features not complete) | nothing |
| spec, no plan, no plan PR, or `spec_stale` | `$FLOW launch <feature> --plan` |
| task `ready` (dependencies merged, plan current) | `$FLOW launch <feature>/<NN>` |
| `running` | nothing |
| run ended `failed`, first time | `launch` again; the second time, escalate |
| run ended with a `question` | answer it if the spec, plan, code or an earlier decision answers it: post the answer with `gh pr comment <pr> -R <repo> --body "…"`, then `launch`. Otherwise escalate |
| review `merge` on the current head | `$FLOW merge <repo tag> <pr>` (`hub` for a plan PR) |
| review `fix` on the current head | `launch <feature>/<NN> --fix`. On the third `fix` for this PR, escalate |
| review `escalate` | escalate, quoting the review's decision |
| review on an older SHA, or no review | `launch <feature>/<NN> --review` |
| PR `CONFLICTING` | `launch <feature>/<NN>` (it merges main and resolves) |
| `escalated`, and the human has replied | apply the reply: `launch`, `merge`, or `--fix` as the reply says |
| `escalated`, no reply yet | nothing |

3. `launch` refuses when it is over `parallel` or the task already runs. That is expected; try again on the next tick.

## Escalate
Only for decisions that belong to the user: scope or a success criterion, a product choice the spec does not answer, irreversible data or production effects, the AI's own settings or rules, credentials or billing, a disagreement still open after 2 fix rounds. Post with `gh pr comment <pr> -R <repo> --body "…"`; you cannot write files. For a plan question with no PR yet, launch the plan run anyway; it opens the PR first.
```
@<human> **Decision needed:** <one sentence>
- **A:** <option> (recommended: <why>)
- **B:** <option>
<context in at most 3 lines, with links>
<!-- flow-escalation -->
```
Write for a person reading on a phone. Never escalate what you can decide from the spec, the plan or the code; decide it, and say so in a short PR comment.

## Rules
- Never two runs on one task. Never merge without a `merge` review on the current head; `flow.js merge` refuses anyway.
- A change to *how* is yours to accept. A change to *what* is always the user's.
- Stop after one pass. Print one line per action: `<feature>/<NN>: <action> (<reason>)`.
- Your last message is exactly one JSON object: `{"status":"done","summary":"<the actions, one line>"}`.
