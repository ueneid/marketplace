# marketplace

Claude Code plugin marketplace for ueneid.

```
/plugin marketplace add ueneid/marketplace
/plugin install agent-tree@ueneid
/plugin install factory@ueneid
```

| Plugin | What it does |
| --- | --- |
| [agent-tree](plugins/agent-tree) | Per-session subagent tracking (model, tokens, status) with optional model selection at spawn via TypeSafe's Jev API. Needs Claude Code 2.1.287 or later. |
| [factory](plugins/factory) | Factory-style orchestration agents and `/factory:run`. Depends on agent-tree. |
