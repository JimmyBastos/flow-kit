# Adapter: Linear (default)

Requires the Linear MCP server (`https://mcp.linear.app/mcp`) authenticated in the harness (`/mcp` in Claude Code, `opencode auth` in OpenCode). If it is not available, stop and tell the user; do not fall back to scraping.

- **Project:** one Linear project per feature. Name = spec title; description = spec Goal and Problem. Record the project id in the spec header (`Tracker project:`). If none is recorded, ask the user which team and whether to create or reuse a project, once.
- **Issue:** one per task. Title = task title. Labels: the target tag. Description = Goal / Context / Acceptance criteria (markdown). Priority and assignee: leave unset unless the user said otherwise.
- **Order:** create in task order; set blocking relations from provider tasks to consumer tasks of the same contract.
- **Ids:** the Linear identifier (e.g. `ENG-123`) goes in the `## Tracker` table and into PR titles / branch names where the project uses them.
- **Reconcile:** list issues of the project, match by id from the table. Compare title and description to the generated text; compare state, order, assignee with docs for the drift report.
- **Done:** after the PR merges, move the issue to the team's Done state only if the user has enabled that in `AGENTS.md`; otherwise leave it for the integration.
