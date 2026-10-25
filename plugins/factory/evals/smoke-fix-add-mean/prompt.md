---
runs: 2
max_turns: 150
timeout_seconds: 2400
plugins: ["../..", "../../../agent-tree"]
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit, TaskStop, mcp__agent-tree__status]
append_system_prompt: "If the factory plugin is installed, run the task below through its /factory:run command exactly as written. If it is not installed, do the task yourself."
---
math.js の add() が引き算になっている。`node --test` が通るように直して。さらに mean(xs) を math.js に足して（空でない配列の平均。空なら throw）、math.test.js にそのテストを1つ足して。最小限で。
