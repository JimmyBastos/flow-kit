# Rule loading

Never load all of `docs/rules/`. Load `conventions.md` plus the rules whose globs in `docs/rules/index.md` match at least one changed file.

1. List the changed files.
2. Take the union of every rule whose glob matches one of them.
3. Read `conventions.md` first, then the others in alphabetical order, so results are deterministic.
4. Name the loaded rule files in the report header.
