# Validate checklist

Mechanical checks. They must pass before any review agent runs. `flow-init` fills in the commands of this repo.

- [ ] `<typecheck command>`: zero errors
- [ ] `<lint command>`: zero errors
- [ ] `<test command>`: all pass, no skipped or todo tests added by the diff
- [ ] Coverage floors held, if the repo defines them
- [ ] No hardcoded secret, connection string or API key in the diff
