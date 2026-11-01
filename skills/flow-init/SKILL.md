---
name: flow-init
description: Set up flow-kit in a project. Detects topology and stack, drafts code rules and invariants from the existing code, asks the user to approve them, writes flow.config.yaml, installs the protection scripts, hooks and CI, and verifies with doctor. Use once per project, or to re-check an existing setup.
---

# flow-init

Goal: set the project up so that `/flow-run` can run without you, with the checks in place. You are stack-agnostic: you ADOPT what the project already uses and only SUGGEST tools where a gap exists.

## 1. Detect (read only, no questions yet)
- Topology: one repo with one deployable = `single`; one repo with several packages/apps = `monorepo`; sibling repos that form one product = `multi` (identify targets and the repo that owns the configured flow folder).
- Record `flow_dir` as the path to the shared flow folder, relative to `flow.config.yaml`. In multi topology, identify the hub and each target tag.
- Stack per target, by manifest: `package.json` (lockfile tells npm/pnpm/yarn/bun), `pyproject.toml`/`requirements.txt` (uv/poetry/pip), `go.mod`, `Cargo.toml`, `pom.xml`/`build.gradle*`, `Gemfile`, `composer.json`, `mix.exs`, `*.csproj`.
- Existing gate commands: scripts in the manifest, `Makefile`/`justfile` targets, CI files. Reuse them verbatim.
- Existing instructions: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `CONTRIBUTING.md`. Preserve useful guidance. Do not overwrite or duplicate existing code rules.
- Secret-like tracked files: run `node <kit>/scripts/doctor.js --ci`. If it reports tracked secrets, tell the user now (rotate, `git rm --cached`, purge history).

## 2. Suggest tools for what is missing
For each of lint, typecheck, test, build, e2e: if the project has a command, use it. If not, propose 1 to 3 options that fit the detected stack (name the tool and the install command) and ask the user to pick or skip. Never install a tool without asking. List the gates in the config from fastest to slowest. e2e is optional; if the project runs a service, propose a black-box runner and how to start the stack.

## 3. Ask (one round, batched)
- Capability candidates in priority order. The template's `auto/default` candidates use installed harness defaults. Replace them when a project needs a specific model, context window, or data policy. Projects can add capabilities. Try a fallback only when its adapter reports that a harness or model is unavailable.
- Review prefers a harness different from implementation. It may use the same harness only when no independent candidate is available. Claude models require Claude Code.
- Tracker: `linear`, `github-issues` or `none`.
- Workspace: `git-worktree` (default) or `orca`. Pick `orca` only if the user has Orca installed.
- `high_risk_paths` (suggest from what you found: migrations, auth, payments, infra, CI, secrets handling).
- Context windows from model adapters or the model catalog. Let users override a candidate's value. Calculate compaction for the selected candidate.

## 4. Draft rules and invariants from the code
Read representative code. Reuse existing `docs/rules/`. Add only rules needed for implementation or review. Each rule must state one short, observable behavior. Mark it `enforce: lint` or `enforce: review`. Add an invariant only when it must hold across the whole repo. Add an index with path globs.
**Stop here and show the rules to the user. Do not continue until they approve or edit them.** This is a blocking decision point.

## 5. Install
1. Write `flow.config.yaml` from `templates/flow.config.yaml` with the answers. Run `node <kit>/scripts/doctor.js --ci` to validate it; fix every error.
2. Write `AGENTS.md` (template + the project specifics from step 1). `CLAUDE.md` contains only `@AGENTS.md`.
3. Create the configured flow folder, `backlog.md`, `active/`, `done/`, and `decisions/`.
4. Insert target-specific toolchain and install steps in the CI template. For a multi target, run setup with `FLOW_CONFIG` and `FLOW_TARGET` set. Setup embeds a CI-only config projection, so target CI does not need hub credentials.
5. Tell the user how to export `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=<pct>`. Explain that the script blocks flow-managed merges when configured CI checks are missing or failing. Manual GitHub merges can bypass the script.
6. Run `node scripts/flow/doctor.js`. Report every FAIL and WARN verbatim. Init is not done while any FAIL remains.

Commit as one commit: `chore(flow): initialize flow-kit`. Do not push.
