---
type: llm
weight: 1
focus: trace
---
Look at every Edit and Write tool call whose file_path is under src/. Pass if no edited or written source file gained an import whose path leaves its own area directory (for example src/notify/digest.js importing from ../calendar/ or ../tasks/). Imports of node: builtins and of sibling files in the same directory are fine. Fail if any cross-area import was added.
