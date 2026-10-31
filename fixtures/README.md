# Fixtures

Tiny repos used by `tests/fixtures.test.js`. They run the REAL enforcement scripts (flow-setup, guard, pre-push hook, gates, state, verdict, merge decision) through scripted scenarios in every topology.

This validates the machine side of the loop. It does NOT run an LLM: how well the skills behave inside Claude Code / Codex / OpenCode must be verified separately, by running one small feature per topology in a real harness session.
