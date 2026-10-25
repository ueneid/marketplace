---
runs: 2
max_turns: 200
timeout_seconds: 3600
plugins: ["../..", "../../../agent-tree"]
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit, TaskStop, mcp__agent-tree__status]
append_system_prompt: "If the factory plugin is installed, run the task below through its /factory:run command exactly as written. If it is not installed, do the task yourself."
---
家族の予定を共有するライブラリ famsched（Node.js、ESM、依存なし）で、`node --test` が 14 件落ちている（42 本中）。README の module map にある 5 つの area（calendar / tasks / inventory / notify / sync）それぞれにバグと未実装がある。落ちているテストが期待する動きを読み取り、全部直して `node --test` をルートから全部通して。

決まり：
- テストファイル（test/ 以下）は変えない。テストが仕様。
- README の通り、変更はその area の src/<area>/ の中だけで行う。area をまたぐ import を足さない。
- 未実装の関数（テストが import しているのに無いもの）は、その area のファイルに export で足す。
- 終わったら、area ごとに何を変えたかと、ルートでの `node --test` の最終結果を報告して。
