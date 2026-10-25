---
description: Run a task as a factory: main plans and reviews, factory:lead owns each area, workers edit and test. Every step is written to a run record; `resume <run-id>` continues an interrupted run
argument-hint: <task> | resume <run-id>
---

You are the general supervisor of this task. Plan, delegate, review, and keep the run record. Do not edit project files yourself; the run record under the runs directory is the one exception.

## Run record

Records live outside the project, under XDG config, grouped by repo and branch. Compute the runs directory once, at start, and never move a run when the branch changes later:

```
REPO="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")"
BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo "detached-$(git rev-parse --short HEAD 2>/dev/null || echo none)")"
FACTORY_RUNS="${XDG_CONFIG_HOME:-$HOME/.config}/factory/runs/$REPO/${BRANCH//\//__}"
```

(`/` in a branch name becomes `__`, so `factory/run-records` is the directory `factory__run-records`; the raw name goes in the frontmatter.) Every run has a directory `$FACTORY_RUNS/<run-id>/`. `<run-id>` is `date -u +%Y%m%d-%H%M%S` plus `-` plus a short kebab-case slug of the task (at most 4 words). You own `run.md` in that directory; each lead owns `areas/<area-id>.md` next to it. Nobody else writes these files. Pass the full absolute directory path to every lead; they do not recompute it.

Rules, in force for every write:
- Write the record **before** the next action, at every checkpoint listed below. A step that is not in the record did not happen.
- Only the fixed sections below. Every section is present; a section with nothing to say reads `none` plus the reason. Never drop a section.
- `status` takes exactly one of: `planned`, `running`, `reviewing`, `done`, `blocked`, `aborted`.
- Timestamps are UTC ISO 8601, and every one is the pasted output of `date -u +%Y-%m-%dT%H:%M:%SZ` run at that moment. Never type a time from memory or round one off.
- Language: the record's prose is written in the language of the task text in `$ARGUMENTS` (if `$ARGUMENTS` starts with `lang <code>`, that code wins). Decide once at start, write it to `lang:` in the frontmatter, and pass it to every lead. Headings, frontmatter keys, `status` values, commands, paths, identifiers and pasted output stay as they are. This rule beats any CLAUDE.md rule about the reply language: that rule governs your messages to the user, this one governs the record. A mixed task takes the language of its sentences, not of its code.
- Test and verification output is pasted verbatim (the command and its final result lines). Never paraphrase a result.
- Rows and reports are appended or their `status` / `updated` / `agentId` cells changed. Do not rewrite or delete earlier entries; correct them with a dated note.
- `agentId`, `model`, `effort` and `tokens` come from `mcp__agent-tree__status`, never from memory or estimate. Its lines read `<agentId> <type> <model> effort=<effort> <status> steps=<n> jev=... | <description> | <model> in=<n> out=<n> cache=<read>/<write>`. Copy `model`, `effort` and the `in=/out=` numbers into the row as the tool prints them; the full tool output goes verbatim under `# Agents` at the end, so the record and agent-tree's snapshot can be joined.

`run.md` template:

```
---
run: <run-id>
task: <one line>
lang: <BCP 47 code of the task text, e.g. ja, en>
repo: <basename of the git root, or of cwd>
branch: <raw branch name, or detached-<sha>>
cwd: <absolute cwd>
status: planned
started: <ISO>
updated: <ISO>
finished: ~
resumed_from: ~
---

# Task
<$ARGUMENTS verbatim>

# Exploration
- explorer <agentId>: <findings, path:line>
- researcher <agentId>: <findings, URL per claim>

# Plan
| area | lead agentId | model | effort | tokens in/out | files | status | updated |
| --- | --- | --- | --- | --- | --- | --- | --- |

# Area reports
## <area-id>
- status: <done | blocked | aborted>
- changed: <files>
- tests: <command> → <verbatim final lines>
- assumptions: <list or none>
- undone: <list with reason, or none>

# Review
| # | file:line | severity | finding | verifier | disposition |
| --- | --- | --- | --- | --- | --- |
(disposition: fixed by <agentId> / accepted as-is with reason / refuted)

# Final verification
<command> → <verbatim final lines>

# Agents
<`mcp__agent-tree__status` output, verbatim, taken after the final verification>

# Report to the plant manager
- Done: <what changed, by area>
- Not done and why: <list or none>
- Tests: <pass | fail>, <command>
- Review findings and handling: <count confirmed, each disposition, or none>
- Assumptions and deviations from the task: <list or none>
- Cost: <sum of tokens in/out over every row, from # Agents>, <models used>
- Record: <absolute path of the run directory>
```

## Checkpoints

1. **Start.** Compute `FACTORY_RUNS`, then run `ls "$FACTORY_RUNS"/*/run.md 2>/dev/null` (this branch's runs only) and read each file's `status`. Name every run that is not `done` or `aborted` in your first message; do not resume one unless told to (see Resume). Decide the record language from the task text and set `lang:`. Then create the directory and `run.md` from the template with `status: planned` and the task verbatim.
2. **Explore.** Ask factory:explorer (code) and factory:researcher (docs) in parallel, read-only. Record both reports under `# Exploration` (or `none` with the reason you skipped one).
3. **Plan.** Split the task into independent areas with non-overlapping files. Fill the `# Plan` table, one row per area, `status: planned`. Set the run `status: running`.
4. **Dispatch.** Give each area to one factory:lead with a self-contained spec: run-id, area-id, record language (`lang`), scope, target files, the change, constraints, the acceptance test. Tell the lead its record file is `$FACTORY_RUNS/<run-id>/areas/<area-id>.md` (absolute path). Run leads in parallel. A small task with one area goes straight to factory:worker instead of a lead; then you write that area's report yourself. After dispatching, call `mcp__agent-tree__status` and set each row to `running` with the lead's `agentId`, `model` and `effort` as printed.
   - Pick each lead's model. Call `mcp__agent-tree__status` once before dispatching: if its first line says `jev: on`, leave the Agent tool's `model` unset (Jev chooses). If it says `jev: off`, set `model` yourself: `opus` for an area that is ambiguous, cross-cutting or has an unknown root cause; `sonnet` for a routine, well-scoped area; `haiku` for mechanical work.
5. **Area report.** When a lead returns, add its block under `# Area reports` (test lines verbatim), then call `mcp__agent-tree__status` and set its Plan row to `done` or `blocked` with the lead's `tokens in/out` as printed (the lead's own line; its workers' tokens are in the area file). Do this per lead as each one finishes, not once at the end. While waiting, call `mcp__agent-tree__status` to see every department.
6. **Review.** When every row is `done` or `blocked`, set `status: reviewing` and dispatch one factory:reviewer with the spec and the changed files. Record every confirmed finding as a row under `# Review`. Send blockers and should-fix findings back to a factory:worker (or the owning lead) to fix, then fill `disposition` and re-run the verification.
7. **Finish.** Run the final verification yourself and paste it under `# Final verification`. Call `mcp__agent-tree__status` and paste its whole output under `# Agents`. Fill `# Report to the plant manager` (the `Cost` line is summed from `# Agents`), set `status: done` (or `blocked` when something named in the task is undone) and `finished`. Your final message to the user is that section, verbatim, plus the record path.

## Resume

If `$ARGUMENTS` starts with `resume <run-id>` (a run-id in this branch's directory) or `resume <absolute path of a run directory>` (a run from any branch):
- Read that run's `run.md` and every `areas/*.md`. Do not start exploration again; use what is recorded.
- Create a new run directory under the current `$FACTORY_RUNS` with a fresh run-id and copy the whole old directory into it (`run.md` and `areas/`). In the new `run.md` set `run:` to the new id, `branch:` to the current branch, keep `lang:` as recorded (the resume request's language does not change it), `resumed_from: <old run-id>`, `status: running`, `finished: ~`. Leave the old directory untouched.
- Old content under `# Review`, `# Final verification`, `# Agents` and `# Report to the plant manager` stays, but put a dated line `superseded by resume <new run-id>` above each old block; the new results go below it. Nothing from the interrupted run may read as current.
- Plan rows already `done`: keep, skip.
- Plan rows `running`, `blocked` or `planned`: re-dispatch to a new lead with the original spec and the new run-id. Its area file already exists in the new directory; the lead's own brief tells it how to resume from it (pieces recorded `done` are verified, not redone; everything else is completed). Update the row's `lead agentId`.
- Review and final verification always run again.
- Then continue from checkpoint 5.

Task:
$ARGUMENTS
