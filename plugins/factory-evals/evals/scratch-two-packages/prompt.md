---
runs: 2
max_turns: 150
timeout_seconds: 2400
plugins: ["../../../factory", "../../../agent-tree"]
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit, TaskStop, mcp__agent-tree__status]
append_system_prompt: "If the factory plugin is installed, run the task below through its /factory:run command exactly as written. If it is not installed, do the task yourself."
---
Build this from the empty repo, in Node.js with no third-party packages. `npm` is not available in this environment, so wire the packages together yourself.
- `packages/core`: a pure library `@scratch/core` (its own package.json) whose entry `packages/core/src/index.js` exports `levenshtein(a, b)` (edit distance) and `similarity(a, b)` (1 - distance / longer length, 1 for two empty strings). node:test tests for both in `packages/core/src/index.test.js`.
- `apps/cli`: `@scratch/cli` with `bin/similar.js` that reads two arguments and prints the similarity with two decimals. It must import from `@scratch/core`, not copy the code. One node:test test that runs the CLI with `node` and checks its output.
- Root `package.json` with `workspaces` listing both, plus `scripts/link.js` that creates the `node_modules/@scratch/core` symlink to `packages/core` (what `npm install` would do). After `node scripts/link.js`, `node --test` from the root must be green for both packages.
