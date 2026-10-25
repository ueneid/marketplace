---
type: llm
weight: 2
---
The final message reports, area by area (calendar, tasks, inventory, notify, sync), what was changed, and states that `node --test` was run from the repository root after all changes with zero failures. Fail if any of the five areas is missing from the report, if the test run is not mentioned, or if failures remain.
