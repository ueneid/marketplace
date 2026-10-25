---
runs: 2
max_turns: 150
timeout_seconds: 2400
plugins: ["../..", "../../../agent-tree"]
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit, TaskStop, mcp__agent-tree__status]
append_system_prompt: "If the factory plugin is installed, run the task below through its /factory:run command exactly as written. If it is not installed, do the task yourself."
---
README を読んでから作業して。`formatName(first, last)` が legacy/names.js にあるが、新しいコードは src/ に置く決まりになっている。src/names.js に同じ動きの `formatName` を作り、test/names.test.js にテストを書いて。終わる前に README の決まりをすべて守ること。
