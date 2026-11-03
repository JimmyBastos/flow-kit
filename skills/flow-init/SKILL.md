---
name: flow-init
description: Set up flow-kit for a product - write .flow/flow.json in the hub repo, install the AI validation gates and rules in each repo, install the orchestrator settings, and create the Orca automation. Use once per product, or again to add a repo or check the setup.
---

# flow-init

Interactive, with the user. Kit files: this skill's `templates/` folder and `../flow-orchestrate/`.

## 1. Detect (read only)
- The hub: the repo that will hold `.flow/` (for one repo, the repo itself). The repos: local paths, default branch, GitHub `owner/name` (`gh repo view --json nameWithOwner`).
- For each repo: the stack, and the lint, typecheck and test commands (manifests, `Makefile`, CI files). The env file the tests need (`.env.test`, `.env.example`, or the env block of CI).
- Existing gates and rules: `.agents/` or `.claude/` skills and agents, `docs/rules/`, `AGENTS.md`, the PR template. Keep everything that exists; never overwrite.
- Duplicate guard layers (`.claude/settings.json` deny lists that block `git rebase` or `git merge`, shell guard hooks). List them; the user decides whether to remove them.

## 2. Ask (one round)
Repos and their tags, the `human` GitHub login for escalations, `parallel` (default 2), the models per role (defaults: orchestrator opus, plan opus, implement sonnet, fix_retry opus, review opus), and per repo the extra commands agents may run (`allow`, for example `["Bash(pnpm *)"]`).

## 3. Rules (blocking: the user approves)
For each repo without `docs/rules/`: read representative code and draft `docs/rules/index.md`, `conventions.md`, one file per area, and `invariants.md` in the formats of `templates/docs/rules/`. Use 8–20 rules: short, observable, each with an id. Show them. **Do not continue until the user approves or edits them.**

## 4. Install, per repo
- Copy any file from `templates/` that does not exist yet: `validate`, `audit`, the `rule-auditor`, `qa-review` and `test-author` agents, the PR template. Fill in `checklist.md` (the real commands) and `layer-map.md` (the real layers).
- Link `.claude/skills/<name>` → `.agents/skills/<name>` and `.claude/agents/<name>.md` → `.agents/agents/<name>.md` when the repo uses that layout.
- Add to `AGENTS.md`, if missing: the check commands, and "Sync a branch with `git merge origin/<default>`, never rebase."
- Commit `chore(flow): install validation gates and rules`, and open a PR. The user merges it, since it changes the AI's own rules.

## 5. Hub
- Write `.flow/flow.json`:
  ```json
  {"product":"<name>","human":"<login>","parallel":2,
   "models":{"orchestrator":"opus","plan":"opus","implement":"sonnet","fix_retry":"opus","review":"opus"},
   "repos":{"<tag>":{"path":"<relative path>","github":"<owner/name>","default":"main","env_file":"<path or null>","allow":["Bash(pnpm *)"]}}}
  ```
- Commit and push.

## 6. Tick
The orchestrator always runs as `node <flow.js> tick --hub <hub>`. That starts a headless session with `../flow-orchestrate/settings/orchestrator.json`, so its limits hold. Orca automations run agents with permissions skipped, so the automation only runs this one command. Create it disabled, and show the user how to enable it:
`orca automations create --name flow-<product> --trigger "*/5 * * * *" --provider claude --extra-agent-args="--model haiku" --workspace path:<hub> --prompt "Run node <flow.js> tick --hub <hub> and print its output. Do nothing else." --precheck "node <flow.js> status --changed-exit --hub <hub>" --precheck-timeout 30 --disabled --json`
For testing and debugging, run `/loop 5m run node <flow.js> tick --hub <hub>` in a session in the hub.

## 7. Check
`node <flow.js> status` runs without errors, `gh auth status` passes, and `orca status` is ready. Report every problem verbatim.
