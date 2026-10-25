---
runs: 2
max_turns: 150
timeout_seconds: 2400
plugins: ["../../../factory", "../../../agent-tree"]
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit, TaskStop, mcp__agent-tree__status]
append_system_prompt: "If the factory plugin is installed, run the task below through its /factory:run command exactly as written. If it is not installed, do the task yourself."
---
src/duration.js に `parseDuration(text)` を作って。`"1h30m"` や `"45s"`、`"2h"` のような文字列を秒数（整数）に変える。単位は h / m / s。test/duration.test.js にテストを書いて `node --test` を通して。
