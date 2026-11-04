# Audit report format

Each `rule-auditor` returns:
```
## Layer: <path>
**file:line** · Rule: <id> (docs/rules/<file>.md) · Severity: high | medium | low
Issue: <description> · Found: <code> · Fix: <suggested code, not applied>
Known drift: <gaps a rule file already documents>
```
If the layer has no findings: "No violations in this layer."

Final report:
```
## Audit: <scope>
### Findings by severity
### Known drift
### Layer summary
| Layer | Files | Findings |
### Fix first
```
Known drift is not a failure. List it apart from new findings.
