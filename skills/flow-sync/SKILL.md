---
name: flow-sync
description: Mirror the flow to Linear, one way - one project per feature, one issue per task, each issue's state from flow.js status. Idempotent, never writes .flow. Run by flow.js tick when .flow/flow.json has a tracker, or by hand in Claude Code or OpenCode with the Linear MCP.
---

# flow-sync

Linear mirrors `.flow/`; it is never the source. You read the hub and write only Linear. Arguments: the exact `flow.js` command (written `$FLOW` below), the hub, its GitHub `owner/name` and default branch, and the tracker (`team`, optional `states`). By hand, read them from `.flow/flow.json` and use `node .claude/skills/flow-orchestrate/flow.js` in the hub.

## Steps
1. `$FLOW status --json`. For each feature in it, read `spec.md` (title: the first `# ` line; Goal) and every file in `tasks/` (title, Goal, Acceptance criteria). Only these facts go to Linear.
2. **Project per feature.** Use the project the spec links on its `Linear` line, if any. Otherwise use the team's project named exactly as the spec title, and create it when there is none (description: the Goal, then a last line `flow: <feature>`).
3. **Issue per task.** List every issue of the project (all pages). The match is the line `flow: <feature>/<NN>` in the description. Create the issue when none matches. Update title, description or state only when they differ. Never delete an issue, and never change one without a `flow:` line: those are older records.
   - Title: `<NN> <task title>`.
   - Description: the Goal; the Acceptance criteria as a checklist, ticked when the task is merged; a link to the task file (`https://github.com/<hub github>/blob/<hub default>/<path>`) and to the PR, if any; then the last line `flow: <feature>/<NN>`.
4. **State**, from the item's `state`, mapped to the team's status of that type (`list_issue_statuses`). A name in `tracker.states` overrides the type.

| flow state | Linear status type |
|---|---|
| `needs-plan`, `waiting-deps` | backlog |
| `ready` | unstarted |
| `running`, `needs-review`, `review-fix`, `review-merge`, `conflicting`, `failed`, `question`, `human-replied` | started |
| `escalated` | started, plus the label `needs-you` (create it once) |
| `merged` | completed |

5. **Project state:** a `blocked` or unplanned feature is backlog, a feature with a running plan or any started task is started, and a feature whose tasks are all merged is completed.
6. **Commands:** Bash only for `$FLOW status`. Read files with the Read tool. A denied command is expected, not a blocker.

## Finish
Your last message is exactly one JSON object: `{"status":"done","summary":"<created n, updated m, unchanged k>"}` or `{"status":"failed","reason":"…"}`.
