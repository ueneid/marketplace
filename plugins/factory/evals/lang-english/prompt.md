---
runs: 2
max_turns: 150
timeout_seconds: 2400
plugins: ["../..", "../../../agent-tree"]
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit, TaskStop, mcp__agent-tree__status]
append_system_prompt: "If the factory plugin is installed, run the task below through its /factory:run command exactly as written. If it is not installed, do the task yourself."
---
`node --test` fails: `capitalize` in text.js lower-cases the rest of the word, but the test expects the rest untouched (so "hELLO" becomes "HELLO"). Fix text.js so the test passes. Do not change the test.
