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
Every run also leaves a written record (next section).

## Run records

Each run writes to `${XDG_CONFIG_HOME:-$HOME/.config}/factory/runs/<repo>/<branch>/<run-id>/`,
where `<repo>` is the basename of the git root (or of the cwd), `<branch>` is the branch name
with `/` turned into `__` (or `detached-<sha>`), and the id is `<UTC yyyymmdd-hhmmss>-<slug>`.
Grouping by branch means a plain `/factory:run` sees only this branch's unfinished runs, which
is what a re-run on the same worktree wants. Records stay out of the project tree, so nothing has to be
gitignored and a removed worktree does not take its history with it. Main owns `run.md`; each
lead owns `areas/<area-id>.md`. The files have one writer each, so they follow the same
non-overlap rule as code.

The record is written at every checkpoint, before the next action: run created, exploration
done, plan made, each lead dispatched, each lead reported, review recorded, final verification
pasted, final report filled. The format is fixed (YAML frontmatter plus named sections; see
`commands/run.md` and `agents/lead.md` for the templates):

- `status` is one of `planned` / `running` / `reviewing` / `done` / `blocked` / `aborted` (`reviewing` is run-level only).
- Timestamps are UTC ISO 8601, each one pasted from `date -u`, never typed.
- Prose is in the language of the task text (`lang:` in the frontmatter; `lang <code>` at the
  start of the task overrides it). Headings, keys, status values, commands and pasted output stay
  English. This beats a CLAUDE.md reply-language rule for the record only; the final message to
  the user still follows CLAUDE.md. A resume keeps the original `lang`.
- Test and verification output is pasted verbatim, never paraphrased.
- Every section is present; an empty one says `none` and why.
- Each area and piece row carries `agentId`, `model`, `effort` and `tokens in/out`, copied from
  `mcp__agent-tree__status` as printed (never estimated). The tool's full output is pasted
  verbatim under `# Agents` at the end of `run.md` and of every area file, so the record can be
  joined with agent-tree's snapshot (Jev verdict, cache tokens, steps) for a retrospective.
- The last section, `Report to the plant manager`, is the run's final message and lists what
  is done, what is not done and why, test results, review findings with their disposition,
  assumptions or deviations from the task, and the run's cost (tokens and models).

**Resume.** `/factory:run resume <run-id>` (this branch) or `resume <absolute run directory>`
(any branch) copies the old run directory to a fresh run-id
with `resumed_from` set, skips areas recorded `done`, re-dispatches the rest (their area files
are already in place, and pieces recorded `done` are verified, not redone), and always re-runs
review and final verification. A plain `/factory:run` names any unfinished run it finds but never resumes
on its own.

The record is kept by the briefs, not enforced by a hook: an agent that skips a
checkpoint leaves a gap, which the fixed sections make visible.

Tested with Claude Code 2.1.288.

## Model choice without Jev

Every agent file says `model: sonnet`. With `TYPESAFE_API_KEY` set, agent-tree's Jev hook
picks the tier at spawn for every `factory:*` agent (no other setting needed). Without it, the briefs tell main (for leads) and leads (for their
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
