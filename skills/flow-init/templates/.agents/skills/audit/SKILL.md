---
name: audit
description: Read-only sweep of the whole repo against docs/rules, fanned out per layer. Gate 0, on demand. Use to audit the codebase or check for rule drift. Never edits.
allowed-tools: Bash, Read, Grep, Glob, Agent
---

# Audit

Repo-wide: "does this codebase still match its own rules?". For one change use `/validate`. Never edits.

## Usage
- `/audit`: every layer
- `/audit <path>`: one layer
- `/audit --rule <id>`: one rule, across every layer it owns

## Steps
1. **Plan the fan-out** from file globs only. Do not read code yourself. Match files to layers with `layer-map.md`.
2. **One `rule-auditor` agent per layer,** with its file list and only the rules `layer-map.md` assigns to it. Run independent layers in parallel.
3. **Assemble** the findings in the format of `report-format.md`. Trust the agents' `file:line` citations.
4. **Output:** findings ranked by severity, known drift listed apart, a summary table per layer, and the findings worth fixing first.

Never run destructive commands. Never edit files.
