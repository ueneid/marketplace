# factory-evals

The eval suite for the `factory` plugin. It is a plugin directory only so that
`claude plugin eval` can load it; it is not listed in `marketplace.json` and never installed.

`evals/` is a `claude plugin eval` suite: eleven golden tasks, each a self-contained fixture
built by its `fixture.sh` (Node, `node:test`, no dependencies) plus graders. One case per
question the design has to answer:

| case | tags | what it measures |
| --- | --- | --- |
| `smoke-fix-add-mean` | smoke | the suite runs at all; two areas that share a file |
| `three-areas` | lead | three disjoint areas: the small end of the lead-tier question |
| `hidden-root-cause` | explore | symptom in one module, bug two imports away |
| `implied-edge-case` | review | spec implies an edge case it does not name |
| `cross-cutting-rename` | rename | one identifier across six files |
| `rules-in-readme` | rules | house rules that must not break across delegation |
| `scratch-typing-cli` | scratch | a typing game from an empty repo |
| `scratch-two-packages` | scratch, lead | two packages with one interface between them |
| `lang-english` | lang | English task: the record-language rule |
| `research-exports-map` | research, network | needs the Node docs; run with WebFetch allowed |
| `large-five-areas` | lead, large | 28 files, five areas with several files each: the case on which the old lead tier actually appeared |

`large-five-areas` ships a `solution.sh` next to its `fixture.sh`: the reference fix for
maintainers, never seen by the agent under test (the workspace holds only what the scaffold
built).

Every case also carries four process graders (`arm: with-only`): `/factory:run` was invoked,
`run.md` was created before the first dispatch (an `llm` grader over the trace, because main
writes the record with a Bash heredoc, not the Write tool), timestamps came from `date -u` (at
least three Bash calls), and the final message names a path under `factory/runs/`. Task graders
are regexes on the fixture's files where possible; `llm` graders only where a regex cannot say.

Sandbox limits, measured on 2026-10-25 with Claude Code 2.1.310: `npm` does not start inside
the eval sandbox (npm installed through a version manager is unreadable there) and `git` is the Xcode shim and fails, so
the tasks say `node --test`, the fixtures need no install, the record lands under repo `cwd` /
branch `detached-none`, and the reviewer cannot `git diff` and reads the named files instead.

The loader only accepts plugins under the target directory, and the cases load `factory` and
`agent-tree` from the sibling directories, so the target is the marketplace root with `--eval-dir`:

```
cd <marketplace root>
claude plugin eval . --eval-dir plugins/factory-evals/evals --tag smoke --runs 1 \
  --ablation none --scaffold --allow-tools Bash Write Edit --max-cost-usd 5 --no-publish
```

- `--scaffold` is required (fixtures are built per run). `--allow-tools Bash Write Edit` is
  required (the default grant is read-only). Add `WebFetch WebSearch` for the `network` tag.
- `--ablation with-without` adds a no-plugin arm: the same task done by a single agent
  loop, which is the baseline the "fold subagents into the main loop" argument asks for.
  First measurement (smoke case, one run each, 2026-10-25, Claude Code 2.1.310): both arms
  scored 1.0; factory took 18 turns, 126 s and $0.54, the single loop 3 turns, 15 s and $0.10.
  One data point on the smallest case, not a verdict; the `lead`, `scratch` and `rules`
  cases are where the two should differ.
- `--no-publish` keeps the HTML report off claude.ai. This repo is public; keep it.
- Each case defaults to `runs: 2`; one run of a factory case is several agents, so set
  `--max-cost-usd` and start with `--tag smoke`.
- `evals/results/` is gitignored.

`evals/compare.sh [--case GLOB] [--tag TAG] [--runs N] [-j N] [--max-cost USD] VARIANT_DIR...`
runs the suite against the unmodified plugin and against each variant (a directory of files
that overlay `plugins/factory/`, see `evals/variants/README.md`) and prints the per-case
scores, cost and seconds side by side, plus, per run, the turns and which agent types main
spawned (read from the kept trace, which is then deleted). That is the loop for the design
questions: fold one thing into a variant, run the same cases, keep the fold only if it does
not score worse.

### Measurements so far

On 2026-10-25 the lead tier was folded into main on the strength of these numbers. In the
table, `baseline` is the design with leads (now `evals/variants/with-lead/`) and `no-lead` is
the design that `plugins/factory/commands/run.md` has had since.

2026-10-25, Claude Code 2.1.310, `--ablation none`, two runs per case (n=2), judge model haiku.
Seconds and turns are per run; USD is per run. "Agent calls" counts every Agent tool call in
the trace at any level (main's, leads' and the reviewer's), so `verifier` is the reviewer's.

| variant | case | score | USD per run | s per run | main turns | Agent calls per run |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | large-five-areas (28 files, 5 areas, 14 failing tests) | 0.97 | 2.16, 2.16 | 353, 323 | 11, 4 | **lead 5**, worker 10 / 13, reviewer 1, verifier 1 / 2 |
| no-lead | large-five-areas | 0.95* | 1.66, 1.49 | 303, 279 | 30, 12 | worker 6 / 6, explorer 0 / 1, reviewer 1, verifier 1 |
| baseline | three-areas (7 files) | 1.00 | 0.61, 0.90 | 163, 207 | 18, 21 | lead 0, explorer 1, worker 1 / 2, reviewer 1, verifier 1 / 4 |
| no-lead | three-areas | 1.00 | 0.79, 0.72 | 185, 173 | 24, 22 | explorer 1, worker 3, reviewer 1, verifier 0 / 1 |
| baseline | scratch-two-packages | 0.93† | 0.96, 0.96 | 243, 255 | 23, 19 | not recorded; run0's own report says one worker |
| no-lead | scratch-two-packages | 0.96† | 1.20, 1.14 | 292, 258 | 4, 25 | not recorded |

\* All four large runs ended with `node --test` at 42/42 (the `all-green` regex passed in every
run). The no-lead gap is the `lead-used` indicator (weight 0.01, fails by design) and one
`reports-green` judge vote on a Japanese report that does list all five areas and 42/42, so
it is judge noise, not a defect. Baseline's gap is one `record-before-dispatch` judge vote
(FAIL FAIL PASS) on run1; the trace was already deleted when this was checked, so whether
main really dispatched before writing run.md on that run is unresolved (compare.sh now keeps
each run's trace under results/ for this reason).
† First-comparison scores carry two grader faults fixed afterwards (a path grader that
matched record content, and a judge that read "from the root" too literally).

What this says. On the small cases main never spawned a lead; the brief's escape hatch
("a small task with one area goes straight to a worker") is what it reached for, and the
two variants tie. On the large case the baseline did use the lead tier as designed (five
leads, ten to thirteen workers) and still tied on correctness, while the no-lead variant did
the same work with six workers at a mean $1.58 against $2.16 per run (27% less) and 291 s
against 338 s (14% less). Two runs each, so the correctness tie is solid and the cost
ordering is likely but not settled. Within n=2, the lead tier has not shown a benefit on any case; its cost is one extra context window
and summary hop per area. Not measured: tasks where one area is too big for one worker's
context, which is the remaining argument for a lead.
