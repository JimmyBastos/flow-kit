# Queue

Features in run order. `/flow-intake` writes the rows. `/flow-run` takes the next runnable row and works until the queue is done.
Status is `draft`, `approved`, `running`, `blocked`, or `done`. A row runs when it is `approved` and every slug in Depends on is `done`.
Change a status with `node scripts/flow/flow-state.js queue <slug> <status>`. Write `-` when a feature depends on nothing.

| Slug | Status | Depends on | Requirement |
|---|---|---|---|
