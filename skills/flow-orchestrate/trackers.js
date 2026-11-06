// Tracker adapters: what flow.js needs to know about an issue tracker. The sync agent mirrors the flow through the
// tracker's MCP server and returns each task's issue as { task, key, url }. flow.js then names that issue on the
// task's PR, the same way for every tracker. To add a tracker, add an adapter with the same shape and a sync skill
// that can reach it.
//
// adapter: { kind, label, key }   label names the tracker in the PR body; key matches a valid issue key.

const linear = { kind: 'linear', label: 'Linear', key: /^[A-Z][A-Z0-9]*-\d+$/ };

export const TRACKERS = { linear };

export function trackerFor(cfg) {
  const t = cfg.tracker;
  if (!t) throw new Error('no tracker in .flow/flow.json');
  const adapter = TRACKERS[t.kind];
  if (!adapter) throw new Error(`tracker kind ${t.kind} is not supported (only ${Object.keys(TRACKERS).join(', ')})`);
  return adapter;
}

// The issues a sync run returned, keeping only well-formed ones.
export function validIssues(issues, tracker) {
  return (Array.isArray(issues) ? issues : []).filter(i => i && /^[\w-]+\/\d+$/.test(i.task) && tracker.key.test(i.key)
    && /^https:\/\//.test(i.url || ''));
}

// A task PR names its issue: the title ends with ` (<key>)`, the body has `<label>: [<key>](<url>)` above `Task:`.
// Trackers that link PRs by key (Linear's GitHub integration does) pick it up from the title.
export function withIssue({ title = '', body = '' }, issue, tracker) {
  const nextTitle = title.includes(issue.key) ? title : `${title} (${issue.key})`;
  let nextBody = body;
  if (!body.includes(issue.key)) {
    const lines = body.split('\n');
    const line = `${tracker.label}: [${issue.key}](${issue.url})`;
    const at = lines.findIndex(l => l.startsWith('Task: '));
    if (at >= 0) lines.splice(at, 0, line); else lines.push('', line);
    nextBody = lines.join('\n');
  }
  return { title: nextTitle, body: nextBody, changed: nextTitle !== title || nextBody !== body };
}
