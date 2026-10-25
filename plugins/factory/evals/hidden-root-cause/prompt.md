---
runs: 2
max_turns: 150
timeout_seconds: 2400
plugins: ["../..", "../../../agent-tree"]
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit, TaskStop, mcp__agent-tree__status]
append_system_prompt: "If the factory plugin is installed, run the task below through its /factory:run command exactly as written. If it is not installed, do the task yourself."
---
`node --test` で cart のテストが落ちる。根本原因を直して。テストは正しいので変えないこと。症状の出ている場所をごまかす直し方はしないこと。
