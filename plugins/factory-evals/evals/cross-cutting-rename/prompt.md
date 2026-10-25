---
runs: 2
max_turns: 150
timeout_seconds: 2400
plugins: ["../../../factory", "../../../agent-tree"]
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit, TaskStop, mcp__agent-tree__status]
append_system_prompt: "If the factory plugin is installed, run the task below through its /factory:run command exactly as written. If it is not installed, do the task yourself."
---
このリポジトリ全体で `userId` を `accountId` に改名して。コード、テスト、README の全部。`node --test` を通して。改名以外の変更はしないこと。
