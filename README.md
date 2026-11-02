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

## Build features

Give it your requirements, approve each feature once, and let it run.

```
/flow-intake             requirements in. It splits them into features, writes the spec, plans and
                         tasks of each, and asks you to approve each feature in one round
/flow-run                works through queue.md, feature after feature, until it needs you
```

`/flow-intake` writes `queue.md`: one row per feature, in run order, with the features it depends on. A feature runs when you approved it and its dependencies are done.

To build one feature by hand, run these commands one at a time. `<slug>` is a short name for the feature.

```
/flow-research <slug>    optional. Reads the code and asks questions until the problem is clear
/flow-spec <slug>        what to build and why
/flow-plan <slug>        how to build it, one file per repo. You approve the spec and plans together
/flow-tasks <slug>       small tasks, about 300 changed code lines each, then the feature check
/flow-run <slug>         runs the tasks one after another, until it needs you
```

`gates.js check` runs before any task starts. It checks that every success criterion is cited by a task, that the tasks have their fields and valid tags, that ticket text has no file paths or estimates, and that the spec and plans fit their caps.

For each task, `/flow-run` does this:

1. The harness writes the code.
2. The gates run.
3. The code is reviewed, and the review writes its verdict to `verdict.json`.
4. A pull request is opened and CI runs.
5. The pull request merges, or waits for you, depending on its risk. It waits if it touches migrations, auth, infra, or CI.

A task starts only after the pull request of the task before it has merged. When a pull request waits for you, `/flow-run` marks that feature `blocked` and continues with features that do not depend on it.

If the review fails, `/flow-run` tries again on the same branch, with the verdict as input. It tries up to 3 times. Then it writes a question and stops. It tells you where it stopped, why, and which file to answer in.

After the last task, run `/flow-drift`. It checks if the code still matches the spec.

You are needed to approve the code rules once, to approve each feature (spec and plans together), to answer questions that change scope or that the plan does not cover, and to merge a high-risk pull request. Serious findings from `/flow-drift` also stop that feature. Everything else runs without you.

`flow-research` interviews the user about decisions that can change the feature. `flow-sync` publishes tasks when a tracker is configured. `flow-audit` checks the whole repo on demand.

## What the scripts check

They are installed in your project in `scripts/flow/`, together with the git hooks and two CI workflows. `flow-gates.yml` runs the pull request's code with a read-only token. `flow-merge.yml` judges and merges, and it runs only code from the base branch.

| What is guaranteed | How |
|---|---|
| The gates ran on every pull request | The `flow-gates` CI workflow runs the target gates |
| A pull request cannot change the code that judges it | `flow-merge` uses `pull_request_target`, so GitHub runs the workflow file and the scripts from the base branch. It reads the pull request's files as data and never runs them |
| Flow-managed merges require named CI checks | `check-ci.js` blocks the merge job when a configured check is missing, pending, or failed |
| Every task branch was reviewed, the review passed, and it covers the code that is merging | `verdict.js ci` requires the verdict of the task named by the branch `flow/<slug>/<id>`. It must be valid and made for the latest code commit |
| Files stay small enough to review | A spec and each plan have at most 60 lines. A task changes at most 300 lines of code; test lines are reported but not counted. If the work does not fit, it is split, never shortened to fit |
| A bug fix starts with a test that fails | `gates.js testfirst` requires the test commit before the fix. `--prove` runs the gates without the fix and requires a failure |
| The AI cannot change its own checks | The merge job always waits for a human to merge changes to the config, CI, hooks, scripts, and rules |
| Low-risk pull requests merge without a person | The merge job runs `gh pr merge --squash` itself. It needs no repository auto-merge setting and no branch protection |
| No force push, hard reset, `git clean`, deleting flow data or `docs/`, local merges, or reading secrets by accident | `guard-destructive.js` and the git `pre-push` hook block them. The guard reads command lines, so it prevents accidents; it is not a security boundary |

### Limits

- The retry limit, staying inside the task, and the quality of the review depend on the skills being followed. The scripts can show that a review is missing or fake. They cannot show that a review is good.
- When a test fails, the harness must find where it broke and why, then fix it. No script checks this. The review looks for tests that were deleted, skipped, or weakened without a reason.
- No script checks that a test exists for each success criterion. `gates.js check` checks that every criterion is cited by a task, and the review checks the tests. The review is done by an AI.
- CI does not run end-to-end tests by default. `/flow-review` runs the `e2e` command of a target on your machine. To run it in CI, add the same command to `gates`.
- The CI script cannot block a person from merging manually in the hosting service. Branch rules can add that protection when available.
- Auto-merge relies on your gates. If your tests are weak, a bad change can merge.
- GitHub does not start new workflow runs for actions made with `GITHUB_TOKEN`. A merge by the merge job does not trigger `on: push` deploy workflows. Deploy with a GitHub App token, or start the deploy `on: workflow_run` of `flow-merge`.

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
  research:
    candidates: [{ harness: auto, model: default }]
    subagent_candidates: [{ harness: auto, model: default }]
  implementation:
    candidates: [{ harness: auto, model: default }, { harness: auto, model: default }]
    retry_candidates: [{ harness: auto, model: default }]
  review:
    prefer_different_harness: true
    candidates: [{ harness: auto, model: default }, { harness: auto, model: default }]
model_policy:
  providers: {}            # optional data-retention and training constraints
limits:
  max_attempts_per_task: 3
  max_task_diff_lines: 300   # code lines; test lines are reported, not counted
  max_spec_lines: 60
  max_plan_lines: 60
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
| `planning` | intake, spec, plans, tasks, drift | opus |
| `research` | leads investigation; subagents do read-only code search | opus; haiku subagents |
| `implementation` | one task per session | sonnet; opus on retry |
| `review` | independent diff review | opus |

`retry_candidates` are selected after a failed review, so a retry does not repeat the same model by accident. `subagent_candidates` are the smaller models a leading session gives read-only searches to, in the same harness. Both are declared in the config; the base candidates stay as the availability fallback. Adapters report availability, model context, and known data policies. Project policy can exclude candidates that retain or train on submitted data.

The starter config uses `auto/default` candidates. It detects an installed harness and uses that adapter's capability default. Projects can replace the defaults with exact model candidates.

Feature-level decisions stay in the plan. Decisions that should guide future features go in `<flow_dir>/decisions/` using `templates/decision.md`.

## Status

There are 100 tests and 38 fixture scenarios (`npm test`, `npm run fixtures`). They use no AI and cover gates, the feature check, the queue, verdicts, CI result selection, capability routing, merge by risk, task progress, push blocks, and setup across all three layouts.

Not tested yet: the skills with real AI models, the hooks inside real sessions, answering from a phone with Orca, and sync with Linear and GitHub. The kit is ready to use but has not run in production. Before you let it run on its own, run one small feature in each layout, from start to end.

## License

[Apache-2.0](LICENSE)
