# Adapter: GitHub Issues

Uses the `gh` CLI, authenticated for the repo (`gh auth status`). For `multi` topology issues live in the hub repo.

- **Project grouping:** a milestone named after the feature slug (`gh api repos/{owner}/{repo}/milestones`), created once.
- **Issue:** `gh issue create --title "<task title>" --body-file <generated> --label "<tag>" --milestone "<slug>"`. Body = Goal / Context / Acceptance criteria as a task list (`- [ ]`).
- **Ids:** `#123` goes in the `## Tracker` table. PRs close them with `Closes #123`.
- **Reconcile:** `gh issue list --milestone "<slug>" --state all --json number,title,body,state,labels`; match by number from the table; compare generated text; report state/label/title edits made only on GitHub as drift.
- **Done:** closing happens through the merged PR (`Closes #n`), not manually.
