---
runs: 2
max_turns: 150
timeout_seconds: 2400
plugins: ["../../../factory", "../../../agent-tree"]
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit, TaskStop, mcp__agent-tree__status]
append_system_prompt: "If the factory plugin is installed, run the task below through its /factory:run command exactly as written. If it is not installed, do the task yourself."
---
空のリポジトリに、小さなタイピングゲームを Node.js で作って。依存パッケージなし（node:test と標準ライブラリだけ）。
- 出題文字列と、打った文字列と、かかった時間（ミリ秒）から、正確さ（%）と WPM を計算する純粋な関数を `src/score.js` に置く
- `node bin/typing.js` で遊べる CLI（標準入力から1行読んで採点して表示）
- 計算関数のテストを `src/score.test.js` に node:test で書き、`node --test` を通す
- README.md に遊び方と計算式を書く
