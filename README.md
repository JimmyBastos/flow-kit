# flow-kit

Approve a spec. An AI orchestrator takes it to merged pull requests. You are asked only when a decision is yours.

flow-kit is 6 skills and one script. The orchestrator is an AI. It plans, starts implementers and reviewers, answers their questions, merges what the review recommends, and asks you on the pull request when it cannot decide. The script, `flow.js`, does the few steps that must be exact: reading the state, starting runs within the limits, and merging only a reviewed commit.

It runs on [Orca](https://github.com/stablyai/orca) and Claude Code, with your subscription.

## How a feature goes live

1. **You:** `/flow-spec <feature>`. The AI asks for your existing material, asks its questions in one round with a recommendation for each, and writes `spec.md`: what and why. You approve it.
2. **Orchestrator (`flow.js tick`, every 5 minutes):** sees the approved spec and starts `/flow-plan`. That writes one short plan per repo and one short file per task, as a pull request. The pull request is reviewed against the spec and merged.
3. **Orchestrator:** starts every task whose dependencies are merged, in parallel, each in its own Orca worktree. Each run is headless: implement → push → pull request → review.
4. **Reviewer:** runs the repo's own validation gates and checks the acceptance criteria. It posts one short comment recommending merge, fix or escalate, tied to the commit it reviewed.
5. **Orchestrator:**
   - on merge, it merges;
   - on fix, it starts a fix run (Sonnet, then Opus);
   - when a question is yours, it @mentions you on the pull request. Reply there, on your phone if you like.
6. The repo's own deploy ships it.

You are needed to approve the rules once, approve each spec, change a spec, and decide what the AI must not decide: product choices the spec doesn't answer, irreversible data effects, the AI's own rules, credentials, and disagreements still open after two fix rounds.

## Install

```bash
npx skills add JimmyBastos/flow-kit -g -a claude-code
```

Then, in the repo that will hold `.flow/` (the hub; for one repo, the repo itself), run in Claude Code:

```
/flow-init
```

It writes `.flow/flow.json` and installs the AI validation gates in each repo: `/validate`, `/audit`, the `qa-review`, `rule-auditor` and `test-author` agents, the rules in `docs/rules/` (drafted from your code, approved by you), and a short pull-request template. It also creates the orchestrator's Orca automation, disabled until you enable it.

## Run

- **Unattended:** enable the `flow-<product>` Orca automation. It only runs `flow.js tick`, because Orca runs automation agents with permissions skipped. A precheck skips the tick when nothing changed, so idle ticks start no model.
- **Watching, to test or debug:** `/loop 5m run node ~/.claude/skills/flow-orchestrate/flow.js tick` in a Claude Code session in the hub.
- **See the state:** `node ~/.claude/skills/flow-orchestrate/flow.js status`.
- **See the history:** `flow.js status --log [--task <feature>/<NN>]`. Every run logs its `session_id`; `claude --resume <session_id>` reopens it.

## Files

```
.flow/flow.json                 product, repos, models, parallel, human
.flow/<feature>/spec.md         what and why          you approve
.flow/<feature>/plan-<repo>.md  how, per repo          AI, reviewed
.flow/<feature>/tasks/NN-*.md   one task each          AI, reviewed; decisions appended on merge
```

Status is never written. `flow.js` derives it from these files, the branches, the pull requests, the review comments and the running Orca terminals.

## What enforces what

| Rule | Enforced by |
|---|---|
| Only you write or change a spec | worker settings deny writes to `.flow/`; only `/flow-spec`, run with you, writes it |
| No task starts on a stale plan | `launch` refuses when the plan's `spec_sha` differs from the spec |
| One run per task; at most `parallel` runs | `launch` refuses otherwise |
| Workers don't push or start other agents | `settings/worker.json`: a strict allowlist, fail-closed, with user settings and hooks not loaded; `flow.js` pushes |
| The orchestrator only decides | `flow.js tick` runs it headless with `settings/orchestrator.json`: only `flow.js` and `gh pr` read and comment, fail-closed (`dontAsk`) |
| Only a reviewed commit merges | `merge` requires a merge review for the current head, green CI and `--match-head-commit` |

## Limits

- Usage limits are not handled yet. A run that hits a limit fails, and the orchestrator retries it later.
- The review is done by an AI. It is as good as the gates and rules it runs.
- Permission rules read command lines. They prevent accidents; they are not a security boundary.

## License

[Apache-2.0](LICENSE)
