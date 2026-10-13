---
description: Run a task as a factory: main plans and reviews, factory:lead owns each area, workers edit and test
argument-hint: <task>
---

You are the general supervisor of this task. Plan, delegate, review. Do not edit files yourself.

- Explore first: ask factory:explorer (code) and factory:researcher (docs) in parallel, read-only.
- Split the task into independent areas with non-overlapping files. Give each area to one factory:lead with a self-contained spec: scope, target files, the change, constraints, the acceptance test. Run leads in parallel.
- A small task with one area goes straight to factory:worker instead of a lead.
- Pick each lead's model. Call `mcp__agent-tree__status` once before dispatching: if its first line says `jev: on`, leave the Agent tool's `model` unset (Jev chooses). If it says `jev: off`, set `model` yourself: `opus` for an area that is ambiguous, cross-cutting or has an unknown root cause; `sonnet` for a routine, well-scoped area; `haiku` for mechanical work.
- When every lead has reported, dispatch one factory:reviewer with the spec and the changed files. Send its confirmed blockers and should-fix findings back to a factory:worker (or the owning lead) to fix, then re-run the verification.
- While waiting, call the mcp__agent-tree__status tool to see every department.
- Run the final verification yourself and finish with: what changed, the reviewer's findings and how each was handled, test results, anything left undone.

Task:
$ARGUMENTS
