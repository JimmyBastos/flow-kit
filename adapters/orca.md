# Adapter: orca

Each task runs in an Orca worktree, so the user sees it in the Orca app and can answer questions from a phone.

- Use the `orca-cli` skill for every Orca call: create the worktree on `flow/<slug>/<id>`, open a terminal in it, start the harness, read the terminal, and send text to it. Do not guess the commands. Read the skill.
- Wait with the `orchestration` skill when it is available. Otherwise read `state.md` and `verdict.json` in the worktree every few seconds.
- Questions: write them with `flow-state.js ask`. The user can answer in the Orca app or in `questions.md`.
- If the `orca` CLI is not installed, STOP and tell the user. Do not switch to `git-worktree` by yourself.
- Remove the worktree with Orca after the pull request merges.
