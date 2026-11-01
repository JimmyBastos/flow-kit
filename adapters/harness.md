# Harness adapter contract

The kit does not bind a capability to one skill or one vendor. A project maps each capability to an ordered list of `{ harness, model, context_window? }` candidates in `flow.config.yaml`.

Each harness adapter must report whether its harness is installed and authenticated, list the models it can run, report known data retention and training policies, start or resume an interactive session with a chosen model, apply its `context_window` and `compaction` values, and classify launch failures as unavailable or task failures. `model: default` asks the adapter to use its capability-specific default. `node scripts/flow/capabilities.js select <capability>` returns the selected candidate and its compaction budget.

The runner may try the next candidate only after an unavailable result. A failed implementation or review must not silently switch models. A review profile may prefer a harness different from the implementation harness; it may use the same harness only when no independent candidate is available.

To add a harness, add an adapter that implements this contract. Do not add project-specific model choices, repository names, credentials, or private workflow details to the kit.

OpenCode can provide model ids and metadata through `opencode models` and its model catalog. Other adapters may use their harness catalog or candidate metadata in `flow.config.yaml`. A project may override a candidate's `context_window` value.
