# flow-kit

Approve a spec. An AI orchestrator takes it to merged pull requests. You are asked only when a decision is yours.

flow-kit is 7 skills and one script. The orchestrator is an AI. It plans, starts implementers and reviewers, answers their questions, merges what the review recommends, and asks you on the pull request when it cannot decide. The script, `flow.js`, does the few steps that must be exact: reading the state, starting runs within the limits, and merging only a reviewed commit.

It runs on [Orca](https://github.com/stablyai/orca), with Claude Code or OpenCode as the agent, on your subscription.

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

Install in the repo that will hold `.flow/` (the hub; for one repo, the repo itself), and commit the skills with it. The other repos need no flow skills: `flow.js` takes each run's skill text from its own folder.

```bash
npx skills add JimmyBastos/flow-kit -a claude-code -a opencode -y
```

OpenCode reads the same skills, so `/flow-spec`, `/flow-init` and `/flow-sync` work there too. The headless runs that `flow.js` starts use the agent `.flow/flow.json` names (see [Agents](#agents)). Below, `<flow.js>` is `.claude/skills/flow-orchestrate/flow.js` in the hub.

Then run in Claude Code or OpenCode, in the hub:

```
/flow-init
```

It writes `.flow/flow.json` and installs the AI validation gates in each repo: `/validate`, `/audit`, the `qa-review`, `rule-auditor` and `test-author` agents, the rules in `docs/rules/` (drafted from your code, approved by you), and a short pull-request template. It also creates the orchestrator's Orca automation, disabled until you enable it.

## Run

- **Unattended:** enable the `flow-<product>` Orca automation. It only runs `flow.js tick`, because Orca runs automation agents with permissions skipped. A precheck skips the tick when nothing changed, so idle ticks start no model.
- **Watching, to test or debug:** `/loop 5m run node <flow.js> tick` in a Claude Code session in the hub, or run `node <flow.js> tick` by hand.
- **See the state:** `node <flow.js> status`.
- **Mirror to Linear:** add `"tracker": {"kind": "linear", "team": "<key>"}` to `.flow/flow.json`. Each tick then runs `/flow-sync`: one Linear project per feature, one issue per task, states from `status`. It is one way: Linear never changes `.flow/`. The sync returns each task's issue, and `flow.js` names it on the task PR: ` (DOS-12)` at the end of the title and a `Linear:` link above `Task:`. Trackers are adapters in `trackers.js`. Run it alone with `flow.js sync`, or `/flow-sync` by hand.
- **See the history:** `flow.js status --log [--task <feature>/<NN>]`. Every run logs its agent, model and `session_id`; `claude --resume <session_id>` or `opencode --session <session_id>` reopens it.

## Files

```
.flow/flow.json                 product, repos, agent, models, parallel, human
.flow/<feature>/spec.md         what and why          you approve; `after: [feature]` waits for other features
.flow/<feature>/plan-<repo>.md  how, per repo          AI, reviewed
.flow/<feature>/tasks/NN-*.md   one task each          AI, reviewed; decisions appended on merge
```

Status is never written. `flow.js` derives it from these files, the branches, the pull requests, the review comments and the running Orca terminals.

## Agents

The whole flow runs on one agent CLI: `claude` (Claude Code, the default) or `opencode`. Pick it in `.flow/flow.json`, or for one run with `FLOW_AGENT=opencode`.

```json
{ "agent": "opencode", "review_agent": "claude",
  "models": { "opencode": { "implement": ["opencode-go/glm-5.3", "opencode-go/kimi-k2.7-code"] } } }
```

- **`review_agent`** (optional) runs only the review on the other agent, so a different model family checks the work.
- **`models`** overrides the defaults in `skills/flow-orchestrate/defaults.json`, per agent and role (`orchestrator`, `plan`, `implement`, `fix_retry`, `review`, `sync`). A role takes one model or a list.
- **A list is a fallback, in the same agent.** The next model runs only when one is unavailable (usage limit, quota, outage, unknown model). A run that fails for any other reason is never retried on another model.
- **Same rules on every agent.** The permission templates in `settings/` are written once, in Claude Code's format. Runs never ask: Claude Code runs with `--dangerously-skip-permissions` and OpenCode with `--auto`, so only the deny rules apply (no push or merge, no `.env`, no edits to the spec, `flow.json` or `.claude`). OpenCode runs `--standalone`, with the rules in `OPENCODE_CONFIG_CONTENT`, above the user's and the repo's own config.
- **MCP on OpenCode:** OpenCode matches MCP tools by exact name only, so a role allowed an MCP server (the tracker) runs with every tool allowed except the built-ins it is not allowed, which are denied by name.
- **Adding an agent** is one adapter in `skills/flow-orchestrate/agents.js` and its models in `defaults.json`.

## What enforces what

| Rule | Enforced by |
|---|---|
| Only you write or change a spec | worker settings deny writes to `.flow/`; only `/flow-spec`, run with you, writes it |
| A feature waits for the features in its `after:` | `launch --plan` refuses until every task of those features is merged |
| No task starts on a stale plan | `launch` refuses when the plan's `spec_sha` differs from the spec |
| One run per task; at most `parallel` runs | `launch` refuses otherwise |
| Workers don't push or start other agents | `settings/worker.json`: a strict allowlist, fail-closed on every agent CLI, with Claude Code's user settings and hooks not loaded; `flow.js` pushes |
| The tracker is only a mirror | `flow.js sync` runs `flow-sync` with `settings/tracker.json`: reads, `flow.js status` and the Linear MCP only; no file writes |
| The orchestrator only decides | `flow.js tick` runs it headless with `settings/orchestrator.json`: only `flow.js` and `gh pr` read and comment, fail-closed (`dontAsk`) |
| Only a reviewed commit merges | `merge` requires a merge review for the current head, green CI and `--match-head-commit` |

## Limits

- A run that hits a usage limit moves to the role's next model. When every model is unavailable, the run fails, and the orchestrator retries it later.
- OpenCode loads the user's global config (plugins included); only its permissions are overridden per run.
- The review is done by an AI. It is as good as the gates and rules it runs.
- Permission rules read command lines. They prevent accidents; they are not a security boundary.

## License

[Apache-2.0](LICENSE)
