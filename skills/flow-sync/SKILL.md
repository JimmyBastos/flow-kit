---
name: flow-sync
description: Publish a feature's tasks to the configured issue tracker (Linear, GitHub Issues, or none) and write the issue ids back. Safe to re-run: it updates existing issues, never creates duplicates, and keeps the docs as the source. Use after flow-analyze passes.
---

# flow-sync

1. Read `tracker` in `flow.config.yaml`. Load `adapters/<tracker>.md` from the flow-kit adapters (installed beside the skills); follow it for the concrete calls. `none`: report "no tracker" and stop.
2. Refuse if `.flow/active/<slug>/analyze.md` has an unresolved `block` finding.
3. **The ticket is generated from the docs.** For each task, generate the ticket from `spec.md` (Goal, one paragraph) and the task's Goal, Context, Acceptance criteria. Never include file paths, line numbers or estimates. Title is the task title with its `[tag]` as a label.
4. **Update, never duplicate.** Match tasks to issues through the ids in the `## Tracker` table of `tasks.md`. Missing issue: create it. Existing: overwrite the generated text only if it differs. Issue with no task: report it, do not delete it.
5. **The docs are the source. Differences are reported.** If the tracker disagrees with the docs on anything other than generated text (status, title, order, assignee, edits made only there), do NOT change the docs and do NOT revert the tracker silently: list each difference in a `Tracker drift` table (task, field, docs value, tracker value) and ask the user per row whether to adopt the tracker's value into the docs.
6. Write the ids back in the `## Tracker` table; commit `docs(flow): sync <slug>`.

The only writes to the tracker are creating/updating the issues of this feature. Never touch other projects' issues.
