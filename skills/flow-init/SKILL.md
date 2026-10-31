---
name: flow-init
description: Set up flow-kit in a project. Detects topology and stack, drafts code rules and invariants from the existing code, asks the user to approve them, writes flow.config.yaml, installs the protection scripts, hooks and CI, and verifies with doctor. Use once per project, or to re-check an existing setup.
---

# flow-init

Goal: set the project up so that `/flow-run` can run without you, with the checks in place. You are stack-agnostic: you ADOPT what the project already uses and only SUGGEST tools where a gap exists.

## 1. Detect (read only, no questions yet)
- Topology: one repo with one deployable = `single`; one repo with several packages/apps (workspaces, `apps/`, `packages/`, multiple manifests) = `monorepo`; several sibling repos that form one product = `multi` (ask for their paths or remotes and which repo is the hub that owns `.flow/`).
- Stack per target, by manifest: `package.json` (lockfile tells npm/pnpm/yarn/bun), `pyproject.toml`/`requirements.txt` (uv/poetry/pip), `go.mod`, `Cargo.toml`, `pom.xml`/`build.gradle*`, `Gemfile`, `composer.json`, `mix.exs`, `*.csproj`.
- Existing gate commands: scripts in the manifest, `Makefile`/`justfile` targets, CI files. Reuse them verbatim.
- Existing instructions: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `CONTRIBUTING.md`. Copy their content into the new `AGENTS.md`. Do not delete it.
- Secret-like tracked files: run `node <kit>/scripts/doctor.js --ci`. If it reports tracked secrets, tell the user now (rotate, `git rm --cached`, purge history).

## 2. Suggest tools for what is missing
For each of lint, typecheck, test, build, e2e: if the project has a command, use it. If not, propose 1 to 3 options that fit the detected stack (name the tool and the install command) and ask the user to pick or skip. Never install a tool without asking. List the gates in the config from fastest to slowest. e2e is optional; if the project runs a service, propose a black-box runner and how to start the stack.

## 3. Ask (one round, batched)
- Harness and model for each stage (research, plan, implement, review). `review.harness` should differ from `implement.harness` when the user has two harnesses. With one harness, accept the same one: the review then runs in a new session, and `doctor` warns. Claude models only run in Claude Code.
- Tracker: `linear`, `github-issues` or `none`.
- Workspace: `git-worktree` (default) or `orca`. Pick `orca` only if the user has Orca installed.
- `high_risk_paths` (suggest from what you found: migrations, auth, payments, infra, CI, secrets handling).
- Context window of the implement model (for compaction settings).

## 4. Draft rules and invariants from the code
Read representative code (entry points, a few of the most-changed files from `git log`). Write 8 to 20 rules to `docs/rules/<topic>.md` using `templates/rule.md`, only what the code ALREADY consistently does or what the project docs state. Mark each `enforce: lint` (a tool can check it; add it to the linter config if the linter supports it, otherwise list it as a missing check) or `enforce: review`. Write `docs/rules/invariants.md` (under 15 properties that must hold everywhere: tenancy, error model, secrets, idempotency, ...). Add `docs/rules/index.md` listing each file with the path globs it applies to.
**Stop here and show the rules to the user. Do not continue until they approve or edit them.** This is a blocking decision point.

## 5. Install
1. Write `flow.config.yaml` from `templates/flow.config.yaml` with the answers. Run `node <kit>/scripts/doctor.js --ci` to validate it; fix every error.
2. Write `AGENTS.md` (template + the project specifics from step 1). `CLAUDE.md` contains only `@AGENTS.md`.
3. Create `.flow/backlog.md` (`slug | problem | why not now | trigger`), `.flow/active/`, `.flow/done/` (with `.gitkeep`).
4. Insert the stack's setup steps (toolchain, install, services) into the marked place in the CI template, then run `node <kit>/scripts/flow-setup.js`.
5. Tell the user, in one block: export `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=<pct>` in the shell that opens Claude Code; enable branch protection on the default branch with the `gates` check required and "allow auto-merge" on (give the exact `gh api` command or the UI path); if the workspace is `orca`, install Orca if it is not present.
6. Run `node scripts/flow/doctor.js`. Report every FAIL and WARN verbatim. Init is not done while any FAIL remains.

Commit as one commit: `chore(flow): initialize flow-kit`. Do not push.
