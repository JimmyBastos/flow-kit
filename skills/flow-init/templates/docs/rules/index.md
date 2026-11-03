# Rules

One file per area. Each rule is one short, observable behavior with an id (`R-001`). `/validate` loads only the files whose glob matches a changed file. `conventions.md` always loads.

| File | Globs | Owns |
|---|---|---|
| `conventions.md` | always | naming, comments, simplicity |
| `<area>.md` | `<glob>` | <what it governs> |

Rule format:
```
## R-001 <short title>
<one sentence: the behavior>. Enforce: lint | review.
Why: <one sentence>.
```
