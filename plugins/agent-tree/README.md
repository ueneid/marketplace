# agent-tree

Claude Code mod: monitoring only. Orchestration (agents and the `/factory:run` command) lives in
the sibling `factory` plugin. Tracks every subagent of a session (type, model, status, per-model
tokens), writes one snapshot per session to the shared mod store, and asks Jev
(TypeSafe) which model tier a subagent needs when the caller left `model` open.

Jev is a hosted judgment model from [TypeSafe](https://typesafe.ai). It is optional:
without `TYPESAFE_API_KEY` nothing is sent anywhere and the model is left as given.
With the key set, each spawn POSTs the subagent's `description` and the first 8000
characters of its `prompt` to `api.typesafe.ai`, so do not enable it where prompts
may carry secrets you do not want to leave the machine.

`orca` in the snapshot is the workspace / worktree / pane tag of
sessions started from the Orca desktop app (a terminal / worktree manager), read from `ORCA_WORKSPACE_ID`,
`ORCA_WORKTREE_ID` and `ORCA_PANE_KEY`. It is `null` outside Orca.

Tested with Claude Code 2.1.288.

## What it hooks

| Event | What happens |
| --- | --- |
| `agent.spawn` | If `TYPESAFE_API_KEY` is set, not a fork, and no `model` was given: POST to TypeSafe and set `model` to Jev's top choice when that choice's probability is >= 0.5. Records the worker with the verdict. |
| `turn.step` | Adds the request's usage to the worker (`e.agentId`) or to main. |
| `turn.complete` | Marks the worker done / aborted. |
| `session.start` / `session.end` | Registers `/agent-tree`, writes the first and last snapshot. |

## Snapshot

Key `session:<session id>` in `$.store`, which is a JSON file under
`~/.claude/plugins/store/`. Any process can read it, so the global view does not
have to be a mod pane.

```
{ id, cwd, repo, orca: { workspace, worktree, pane } | null, startedAt, updatedAt, endedAt,
  links: [{ dir: 'out', to } | { dir: 'in', from }],
  main: { model, tokens: { [model]: { input, output, cacheRead, cacheWrite } } },
  workers: { [agentId]: { type, description, model, requestedModel, fork, background,
                          parentAgentId, status, startedAt, updatedAt, durationMs,
                          steps, tokens, jev: { ok, choice, confidence, probabilities, applied, reason } } } }
```

## Jev API key

The mod reads `TYPESAFE_API_KEY` from the environment once per session. Without it,
Jev is skipped and each worker's `jev.reason` says `no TYPESAFE_API_KEY`.

Keep the key in 1Password and inject it only for the `claude` process, for example:

```
# fish
set -x TYPESAFE_API_KEY (op read "op://<vault>/<item>/credential"); claude

# or, with a .env file that holds TYPESAFE_API_KEY=op://<vault>/<item>/credential
op run --env-file=.env -- claude
```

## Commands

- Tool `mcp__agent-tree__status`: first line `jev: on` / `jev: off (reason)`, then the agents as a
  tree: main sees every agent; a subagent calling it sees only its own subtree (factory's leads use
  this to decide whether to pick models themselves).
- The monitor pane opens by itself when the first subagent starts (terminal at least
  144 columns wide; otherwise a toast says so). `/agent-tree open` / `/agent-tree close`
  open and close it by hand. It shows the main session's bar, one card per department
  (lead or top-level worker) with its model, Jev verdict, token bar and workers, and a
  log of spawn/done events.
- The graph is always drawn. When it is wider than the pane it becomes a window: `h` / `l`
  (or the ◀ ▶ buttons) scroll it sideways, and the header says `cols 41–194 of 302`. `g`
  switches to the card list and back. The `details` select under the graph shows one agent's
  full description, model, Jev verdict with every probability, tokens, duration and the first
  400 characters of its final report.
- While workers exist, one line under the prompt shows them:
  `2 running / 3 total · explorer sonnet-5 1.2k✓ · worker* sonnet-5 3.4k…` (`*` = model chosen by Jev).
- `/agent-tree` prints this session as text.
- `/agent-tree all` opens the **fleet pane**: every session in the store as repo → worktree →
  session → agent graph, with model totals on top. Tabs along the top filter it: digits pick a
  repo (`1` = all), `r` shows only sessions with a running agent, `w` only this worktree; the pane
  needs keyboard focus for the keys (it opens focused; Ctrl+X then Tab refocuses). The same
  filters work from the command: `/agent-tree all my-repo --running --worktree`. The pane
  redraws every 3 seconds so other sessions' progress shows up.
- `/agent-tree list` prints the same grouping as plain text.
- `/agent-tree focus` gives the keyboard to the shown pane (same as Ctrl+X then Tab).
- `/agent-tree env` prints the facts the engine uses for placement: columns, rows and
  whether fullscreen rendering is on (docked beside the transcript needs fullscreen and
  at least 110 columns; otherwise the pane sits above the prompt), plus each open pane's state.
  A session line carries its Orca workspace/worktree tags when started from Orca, `[ended]`,
  and `links:` (`→id` messages it sent, `←name` messages it received) so sessions that talk
  to each other can be matched up. Who started whom across sessions is not knowable from
  inside Claude Code except through those messages.

## Install

```
/plugin install agent-tree --marketplace ueneid/marketplace
```

For in-place development, add this checkout as a local marketplace instead; a
relative-path plugin from a local marketplace loads **in place**, so edits apply at
the next session start:

```
claude plugin marketplace add /path/to/marketplace
claude plugin install agent-tree@ueneid
```


## Develop

```
claude plugin validate .
claude plugin test
claude --plugin-dir . 
```
