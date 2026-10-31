# Adapter: git-worktree

The default workspace. Each task runs in its own git worktree, and the user watches it in the terminal.

- Create the worktree: `git worktree add ../<repo>-<slug>-<id> -b flow/<slug>/<id> <default branch>`. If the branch exists, use `git worktree add ../<repo>-<slug>-<id> flow/<slug>/<id>`.
- Open a harness in that folder. If you cannot open a harness yourself, tell the user the folder and the command to run, and wait.
- Wait by reading `state.md` and `verdict.json` in the worktree. Check them again every few seconds.
- Questions: write them with `flow-state.js ask`. The user answers in `questions.md`.
- Remove the worktree after the pull request merges: `git worktree remove <folder>`.
