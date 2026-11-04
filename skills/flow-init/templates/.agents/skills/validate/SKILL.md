---
name: validate
description: Validate a diff against the repo's own rules that apply to the touched paths. Gate 1, before qa-review. Use to validate local changes, a branch, or a pull request before merging.
allowed-tools: Bash, Read, Grep, Glob, Agent
---

# Validate

Diff-scoped gate: "is this change safe to merge?". For "does the whole repo still match its rules?" use `/audit`.

## Usage
- `/validate`: all local changes (`git diff HEAD`)
- `/validate pr <N>`: pull request N (`gh pr diff <N>`)
- `/validate --base <ref>`: the branch against `<ref>` (`git diff <ref>...HEAD`)

## Steps
1. **Scope.** List the changed files for the chosen mode.
2. **Mechanical checks.** Run `checklist.md`. If one fails, stop and report it. Do not review code that does not build.
3. **Load only the rules the diff touches.** Match the changed files against the globs in `docs/rules/index.md` (see `rule-loading.md`). State the rule files you loaded.
4. **Review.** 1–5 files: one agent with the prompt below. More: batches of about 5 files, at most 4 agents in parallel. A pull request: one agent.
5. **Report**, grouped by file, then rule:
   ```
   ## Validate: <scope>
   Rules loaded: <list>
   **file:line** · Rule: <id> (docs/rules/<file>.md) · Found: <code> · Fix: <code>
   Result: pass | fail (<N> violations)
   ```

## Agent prompt
> Read only these rule files: <list>. Check the diff against exactly those rules. Report each violation as `file:line`, rule id, the quoted code, and the fix. Re-open the file before reporting; no finding without a quote. Style that no rule states is not a violation. If none: "All rules passed." Diff: <diff>
