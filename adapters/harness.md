# Harness adapter contract

The kit does not bind a capability to one skill or one vendor. A project maps each capability to an ordered list of `{ harness, model, data_policy? }` candidates in `flow.config.yaml`.

The kit's capabilities are `planning`, `research`, `implementation`, and `review`. A project may add more.

Each harness adapter must report whether its harness is installed and authenticated, list the models it can run, report known data retention and training policies, start or resume an interactive session with a chosen model, and classify launch failures as unavailable or task failures. `model: default` asks the adapter to use its capability-specific default. A variant candidate uses the `<capability>.<variant>` default when the adapter has one, else the capability default. `node scripts/flow/capabilities.js select <capability>` returns the selected candidate.

The runner may try the next candidate only after an unavailable result. A failed implementation or review must not silently switch models. A profile may declare `retry_candidates`, selected with `--retry` after a failed review. Variant candidates come first; the base candidates remain the availability fallback. A review profile may prefer a harness different from the implementation harness; it may use the same harness only when no independent candidate is available.

## Subagents

`research` has two tiers. Its `candidates` lead the work: they split it, judge the findings, and write the result. Its `subagent_candidates` are smaller models that do read-only searches in parallel. Any skill that reads a lot of code (research, plan, drift, audit) hands the reading to research subagents:

1. Run `node scripts/flow/capabilities.js select research --subagent --available-harness <this session's harness>`. A subagent runs inside the session that starts it, so it must use the same harness.
2. Start one subagent per target, partition, or question, with the returned model. Claude Code: the Agent tool's `model` parameter. OpenCode: an agent with `mode: subagent` and `model` in `opencode.json`. Codex: a separate `codex exec` run with `--model`.
3. Ask each subagent for findings with `path:line` evidence only. The leading session checks the evidence and decides. Subagents never edit files.
4. If the harness cannot start a subagent with that model, do the reading in the leading session.

Implementation and review never use subagents for their main work. One session owns the diff, and one session owns the verdict.

To add a harness, add an adapter that implements this contract. Do not add project-specific model choices, repository names, credentials, or private workflow details to the kit.

OpenCode lists model ids with `opencode models`. Each harness compacts long sessions itself; `state.md` and the PreCompact and SessionStart hooks let any session resume a task. The claude-code defaults assume the Anthropic API, where `opus`, `sonnet` and `haiku` name the current models. On Bedrock, Vertex, or Foundry the aliases can name older models, so set exact models in the project config.
