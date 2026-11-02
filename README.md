# flow-kit

Run AI-written features to a merged pull request, with tests and review, in any harness.

flow-kit is a set of skills and scripts. The AI writes the code. Scripts check that the tests ran, that the code was reviewed, and that the change is small enough to read. You decide only when your decision is needed.

It works with one repo, a monorepo, or several repos that make up one product. It includes adapters for Claude Code, Codex, and OpenCode. Other harnesses can add an adapter. It uses subscriptions you already have and needs no API credits.

## Recommended stack

| Layer | Tool | What it does |
|---|---|---|
| Workspace | [Orca](https://github.com/stablyai/orca) | A desktop app that runs agents in parallel, each in its own git worktree. Set `workspace: orca` and `/flow-run` opens each task there. You can answer questions from your phone |
| Harness | Claude Code, Codex, or OpenCode | The AI tool that runs the skills and writes the code |

flow-kit needs only a harness. Orca is optional. Without it, `workspace: git-worktree` runs each task in a plain git worktree.

## Why it exists

I had three problems.

1. I could not trust that the work was right. When the AI says the work is done, nothing shows that it is true. I wanted proof that does not depend on the AI. So the CI pipeline runs lint, types, tests, and build on every pull request. And the criteria for "done" are written before the code, one by one, so each task and each review can be checked against them.
2. I could not switch tools in the middle of a task. I wanted to stop in one harness and continue in another. So each task saves what is done and what comes next in a file in the repo, called `state.md`. A new session in any harness reads that file and continues.
3. I wanted my projects to run a flow that writes code all day, every day, and always knows what each task has done. Each task is small. Each task has a limit on retries. When a test fails, the AI must find where it broke and why, and fix it. It cannot blame someone else, skip the test, or weaken it. When the flow does not know what to do, for example if it cannot tell whether the test or the code is wrong, it writes a question and stops. It does not guess.

The main idea is that instructions in a prompt can be ignored, and a script cannot. So the checks in this kit are scripts that pass or fail. They run on your machine and run again in CI.

## Get started

You need git, Node 20 or newer, and at least one harness. The scripts use only what comes with Node, so there is nothing to install with npm. The `skills` installer itself needs Node 22.20 or newer.

```bash
# in your project root
npx skills add JimmyBastos/flow-kit -a claude-code -a opencode -a codex
```

Then run this in your harness, not in your terminal:

```
/flow-init
```

`flow-init` finds your stack and your existing lint, types, tests, and build commands. These become the gates. A gate is a check that must pass before code can merge. It writes 8 to 20 code rules from your code, and you must approve them. Then it installs the scripts and runs `doctor`. The install is not done while `doctor` reports a FAIL.

## Build a feature

Run these commands one at a time, in your harness.

```
/flow-research <slug>    optional. Questions until the problem is clear
/flow-spec <slug>        what to build and why. You approve
/flow-plan <slug>        how to build it, one file per repo. You approve
/flow-tasks <slug>       a list of small tasks, about 300 changed lines each
/flow-analyze <slug>     checks that spec, plan, and tasks agree. It changes nothing
/flow-run <slug>         runs the tasks one after another, until it needs you
```

`<slug>` is a short name for the feature.

For each task, `/flow-run` does this:

1. The harness writes the code.
2. The gates run.
3. The code is reviewed, and the review writes its verdict to `verdict.json`.
4. A pull request is opened and CI runs.
5. The pull request merges, or waits for you, depending on its risk. It waits if it touches migrations, auth, infra, or CI.

If the review fails, `/flow-run` tries again on the same branch, with the verdict as input. It tries up to 3 times. Then it writes a question and stops. It tells you where it stopped, why, and which file to answer in.

After the last task, run `/flow-drift`. It checks if the code still matches the spec.

You are needed to approve the code rules, the spec, and the plan, to answer research questions, to answer any question the plan does not cover, and to merge a high-risk pull request. Serious findings from `/flow-analyze` and `/flow-drift` also stop the flow. Everything else runs without you.

`flow-research` interviews the user about decisions that can change the feature. `flow-sync` publishes tasks when a tracker is configured. `flow-audit` checks the whole repo on demand.

## What the scripts check

They are installed in your project in `scripts/flow/`, together with the git hooks and the CI workflow.

| What is guaranteed | How |
|---|---|
| The gates ran on every pull request | The `flow-gates` CI workflow runs the target gates |
| Flow-managed merges require named CI checks | `check-ci.js` blocks the merge job when a configured check is missing, pending, or failed |
| A review happened, passed, and covers the code that is merging | `verdict.js ci` checks that the verdict exists, is valid, and was made for the latest commit. If the code changed after the review, the pull request is rejected |
| Files stay small enough to review | A spec and each plan have at most 60 lines. A task changes at most 300 lines. If the work does not fit, it is split, never shortened to fit |
| A bug fix starts with a test that fails | `gates.js testfirst` requires the failing test to come before the fix |
| No force push, hard reset, `git clean`, deleting flow data or `docs/`, or reading secrets | `guard-destructive.js` and the git `pre-push` hook block them |
| The AI cannot change its own checks | `merge.js` always waits for a human to merge changes to the config, CI, hooks, and rules |
| Plain language in specs, plans, and tasks | `gates.js text` flags sentences over 25 words and a list of vague words. It is a word list, so it can raise false alarms |

### Limits

- The retry limit, staying inside the task, and the quality of the review depend on the skills being followed. The scripts can show that a review is missing or fake. They cannot show that a review is good.
- When a test fails, the harness must find where it broke and why, then fix it. No script checks this. The review looks for tests that were deleted, skipped, or weakened without a reason.
- No script checks that a test exists for each success criterion. `/flow-analyze` checks that every criterion is covered by a task, and the review checks the tests. The review is done by an AI.
- CI does not run end-to-end tests by default. `/flow-review` runs the `e2e` command of a target on your machine. To run it in CI, add the same command to `gates`.
- The CI script cannot block a person from merging manually in the hosting service. Branch rules can add that protection when available.
- Auto-merge relies on your gates. If your tests are weak, a bad change can merge.

## Configuration

The config is one file, `flow.config.yaml`. `flow-init` writes it. It uses a small part of YAML (2-space indent, no anchors, no multi-line strings) so the scripts need no dependencies.

```yaml
topology: single            # single | monorepo | multi
flow_dir: .flow             # path relative to flow.config.yaml
targets:
  - tag: app
    path: .                 # or remote: git@host:org/repo.git
    gates: ["npm run lint", "npm run typecheck", "npm test", "npm run build"]
    # e2e: "npm run e2e"    # optional, run by flow-review
tracker: none               # linear | github-issues | none
workspace: git-worktree     # git-worktree | orca
fallback: unavailable       # only fall back when a harness or model is unavailable
capabilities:
  planning:
    candidates: [{ harness: auto, model: default }, { harness: auto, model: default }]
  repository_exploration:
    candidates: [{ harness: auto, model: default }, { harness: auto, model: default }]
  implementation:
    candidates: [{ harness: auto, model: default }, { harness: auto, model: default }]
    retry_candidates: [{ harness: auto, model: default }]
  review:
    prefer_different_harness: true
    candidates: [{ harness: auto, model: default }, { harness: auto, model: default }]
  utility:
    candidates: [{ harness: auto, model: default }]
model_policy:
  providers: {}            # optional data-retention and training constraints
limits:
  max_attempts_per_task: 3
  max_task_diff_lines: 300
  max_spec_lines: 60
  max_plan_lines: 60
approvals:                  # a finding category not listed here counts as block
  analyze: { block: [contract, coverage, not_included], ask: [scope], log: [format] }
  drift:   { block: [contradicts_spec], ask: [new_behavior], log: [rename, refactor] }
merge:
  auto: true                # auto-merge a passing PR, unless it touches:
  required_checks: ["flow-gates / gates"]
  high_risk_paths: ["**/migrations/**", "**/auth/**", ".github/**", "infra/**"]
```

`workspace` says where each task runs: `git-worktree` (the default) or `orca`. Each one has a file in `adapters/` that `/flow-run` follows. Harness adapters use the contract in `adapters/harness.md`.

`topology` is `single` for one repo, `monorepo` for one repo with several packages, and `multi` for several repos that make up one product. The config's `flow_dir` points to the shared flow folder. Interactive target worktrees set `FLOW_DIR` to the hub folder. Target CI uses a generated config projection and needs no hub credentials.

Capabilities are independent of skills. A skill requests a capability; the config lists ordered `(harness, model)` candidates.

| Capability | Used for | Claude Code default |
|---|---|---|
| `planning` | research, spec, plans, analyze, drift | opus |
| `repository_exploration` | read-only code search | haiku |
| `implementation` | one task per session | sonnet; opus on retry |
| `review` | independent diff review | opus |
| `utility` | commit messages, PR bodies, tickets, summaries | haiku |

`retry_candidates` are selected after a failed review, so a retry does not repeat the same model by accident. `high_risk_candidates` are selected for review when the diff touches `merge.high_risk_paths`. Both are declared in the config; the base candidates stay as the availability fallback. Adapters report availability, model context, and known data policies. Project policy can exclude candidates that retain or train on submitted data.

The starter config uses `auto/default` candidates. It detects an installed harness and uses that adapter's capability default. Projects can replace the defaults with exact model candidates.

Feature-level decisions stay in the plan. Decisions that should guide future features go in `<flow_dir>/decisions/` using `templates/decision.md`.

## Status

There are 87 tests and 29 fixture scenarios (`npm test`, `npm run fixtures`). They use no AI and cover gates, verdicts, CI result selection, capability routing, merge by risk, task progress, push blocks, and setup across all three layouts.

Not tested yet: the skills with real AI models, the hooks inside real sessions, answering from a phone with Orca, and sync with Linear and GitHub. The kit is ready to use but has not run in production. Before you let it run on its own, run one small feature in each layout, from start to end.

## License

[Apache-2.0](LICENSE)
