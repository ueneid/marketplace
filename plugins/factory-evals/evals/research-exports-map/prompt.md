---
runs: 2
max_turns: 150
timeout_seconds: 2400
plugins: ["../../../factory", "../../../agent-tree"]
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit, TaskStop, mcp__agent-tree__status, WebFetch, WebSearch]
append_system_prompt: "If the factory plugin is installed, run the task below through its /factory:run command exactly as written. If it is not installed, do the task yourself."
---
このパッケージに、Node.js 公式ドキュメントの「conditional exports」に沿った `exports` を package.json に足して。入口は2つ：`.`（src/index.js）と `./ja`（src/ja.js）。それぞれに `types`（対応する .d.ts）と `import` の条件を書き、Node のドキュメントが決めている条件の並び順の決まりに従って。根拠にしたドキュメントの URL を最後の報告に書いて。`node --test` は通ったままにして。
