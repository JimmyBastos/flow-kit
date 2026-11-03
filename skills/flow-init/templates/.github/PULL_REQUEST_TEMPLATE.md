## What

<!-- At most 5 bullets. Name the capability, not the code. Never list files or changes one by one: the diff shows them. -->

-

## Why

<!-- At most 3 sentences: what this enables, and for whom. -->

## Notes

<!-- Optional; delete if empty. Only what would surprise a reviewer: a deploy step, a migration, a decision taken. -->

## Validations

- [ ] `/validate`: diff against the rules that apply (gate 1)
- [ ] `<test command>`: tests pass (gate 2)
- [ ] `qa-review`: adversarial review of the invariants (gate 3)
- [ ] `/audit`: whole repo against the rules (gate 0, on demand, not per PR)
