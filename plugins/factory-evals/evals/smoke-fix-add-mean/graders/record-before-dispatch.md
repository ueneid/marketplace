---
type: llm
focus: trace
arm: with-only
---
Look at the tool calls in order. Before the first Agent tool call, a Bash (or Write) call must create a file named run.md under a directory ending in `/factory/runs/...` with `status: planned` and the task text in it. Pass if such a call appears before the first Agent call. Fail if run.md is created after the first Agent call, or never.
