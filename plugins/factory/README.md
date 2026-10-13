# factory

Orchestration only: six agents and one command. No code. Monitoring and Jev model
selection (an optional TypeSafe API, see agent-tree's README) come from the `agent-tree`
plugin, which this one depends on.

| Agent | Role |
| --- | --- |
| `factory:lead` | Department lead: splits one area into worker-sized pieces, dispatches, verifies, reports. Can only spawn the three below. |
| `factory:worker` | Edits files and runs the tests for one well-specified piece. |
| `factory:explorer` | Read-only code exploration. |
| `factory:researcher` | Documentation lookup with a URL per claim. |
| `factory:reviewer` | Independent review of the finished change against the spec (opus, effort high). Sends each finding to a verifier and reports only the survivors. |
| `factory:verifier` | Tries to refute one review finding from the code and tests; answers confirmed or refuted with evidence. |

`/factory:run <task>` hands the task to the main session as the general supervisor.
You never name the agents yourself; the brief does. Progress shows in agent-tree's
status line and panes; leads call `mcp__agent-tree__status` to see their own department.

Tested with Claude Code 2.1.288.

## Model choice without Jev

Every agent file says `model: sonnet`. With `TYPESAFE_API_KEY` set, agent-tree's Jev hook
picks the tier at spawn. Without it, the briefs tell main (for leads) and leads (for their
pieces) to call `mcp__agent-tree__status`, read its first line (`jev: on` / `jev: off`), and
when off, pass `model` themselves: opus for ambiguous or cross-cutting work, sonnet for routine
scoped work, haiku for mechanical edits.

## Effort

Following the Claude Code guidance (medium = clear-scope day-to-day work; high = where
verification matters): lead and reviewer run at `high`, worker / explorer / researcher /
verifier at `medium`. Main keeps the session's level.

## Install

```
/plugin install factory --marketplace ueneid/marketplace
```
