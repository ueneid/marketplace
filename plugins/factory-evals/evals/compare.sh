#!/usr/bin/env bash
# Run the factory eval suite against one or more variants of the plugin and print
# the scores side by side. A variant is a directory whose files overlay
# plugins/factory (for example variants/with-lead/commands/run.md). The unmodified
# plugin is always run first as "baseline".
#
#   plugins/factory-evals/evals/compare.sh [--case GLOB] [--tag TAG] [--runs N] [-j N] [--max-cost USD] [--allow-network] [VARIANT_DIR...]
#
# Each variant runs in its own copy of plugins/ (factory, agent-tree and this suite, which
# the eval loader only accepts when all sit under the same target root). Results land
# in plugins/factory-evals/evals/results/compare-<timestamp>/<variant>.json, with the agent mix per run read from the
# kept trace, which is copied to results/<variant>/traces/ before the sandbox is removed. Nothing is published.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"            # plugins/factory-evals/evals
plugins_dir="$(cd "$here/../.." && pwd)"         # plugins/
case_glob='*'; tag=''; runs=2; max_cost=''; network=0; jobs=1
variants=()
while [ $# -gt 0 ]; do
  case "$1" in
    --case) case_glob="$2"; shift 2 ;;
    --tag) tag="$2"; shift 2 ;;
    --runs) runs="$2"; shift 2 ;;
    --max-cost) max_cost="$2"; shift 2 ;;
    --allow-network) network=1; shift ;;
    -j|--concurrency) jobs="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) variants+=("$(cd "$1" && pwd)"); shift ;;
  esac
done

stamp="$(date -u +%Y%m%d-%H%M%S)"
out="$here/results/compare-$stamp"
work="${TMPDIR:-/tmp}/factory-compare-$stamp"
mkdir -p "$out" "$work"

tools=(Bash Write Edit)
[ "$network" = 1 ] && tools+=(WebFetch WebSearch)

run_one() { # name overlay-dir-or-empty
  local name="$1"
  local overlay="$2"
  local root="$work/$name"
  mkdir -p "$root/plugins"
  cp -R "$plugins_dir/factory" "$root/plugins/factory"
  cp -R "$plugins_dir/agent-tree" "$root/plugins/agent-tree"
  cp -R "$plugins_dir/factory-evals" "$root/plugins/factory-evals"
  rm -rf "$root/plugins/factory-evals/evals/results"
  if [ -n "$overlay" ]; then
    (cd "$overlay" && find . -type f -not -name 'README.md' -not -name 'VARIANT.md' | while read -r f; do
      mkdir -p "$root/plugins/factory/$(dirname "$f")"; cp "$f" "$root/plugins/factory/$f"; done)
  fi
  local args=(plugin eval "$root" --eval-dir plugins/factory-evals/evals --case "$case_glob" --runs "$runs"
              --ablation none -j "$jobs" --scaffold --trust-plugin --keep-temp --allow-tools "${tools[@]}" --no-publish
              --output-dir "$out/$name" --json "$out/$name.json")
  [ -n "$tag" ] && args+=(--tag "$tag")
  [ -n "$max_cost" ] && args+=(--max-cost-usd "$max_cost")
  echo "== $name" >&2
  claude "${args[@]}" || echo "($name exited $?)" >&2
}

run_one baseline ""
for v in ${variants[@]+"${variants[@]}"}; do run_one "$(basename "$v")" "$v"; done

node - "$out" <<'JS'
const fs = require('node:fs'), path = require('node:path');
const out = process.argv[2];
const files = fs.readdirSync(out).filter(f => f.endsWith('.json')).sort((a, b) => a === 'baseline.json' ? -1 : b === 'baseline.json' ? 1 : a.localeCompare(b));
const runs = files.map(f => ({ name: f.replace(/\.json$/, ''), d: JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')) }));
// Agent mix per run, read from the kept trace: every Agent tool call at any level (main's and its
// subagents'), by subagent type.
const kept = new Set();
function agentMix(tracePath, saveAs) {
  const mix = {};
  if (!tracePath || !fs.existsSync(tracePath)) return mix;
  kept.add(path.resolve(tracePath, '..', '..'));
  // Keep the trace itself under results/ so a grader verdict can be audited later.
  try { fs.mkdirSync(path.dirname(saveAs), { recursive: true }); fs.copyFileSync(tracePath, saveAs); } catch {}
  for (const line of fs.readFileSync(tracePath, 'utf8').split('\n')) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    const content = (m.message || m).content;
    if (!Array.isArray(content)) continue;
    for (const b of content) if (b && b.type === 'tool_use' && b.name === 'Agent') {
      const t = String((b.input || {}).subagent_type || '?').replace(/^factory:/, '');
      mix[t] = (mix[t] || 0) + 1;
    }
  }
  return mix;
}
const fmt = (mix) => Object.entries(mix).sort().map(([k, v]) => `${k}=${v}`).join(' ') || '-';
const cases = [...new Set(runs.flatMap(r => r.d.cases.map(c => c.name)))].sort();
const pad = (s, n) => String(s).padEnd(n);
const w = Math.max(10, ...runs.map(r => r.name.length)) + 2;
console.log(pad('case', 24) + runs.map(r => pad(r.name, w)).join(''));
for (const c of cases) {
  console.log(pad(c, 24) + runs.map(r => { const x = r.d.cases.find(k => k.name === c); return pad(x ? x.aggregates.score.toFixed(2) : '-', w); }).join(''));
}
console.log(pad('overall', 24) + runs.map(r => pad(r.d.aggregates.overallScore.toFixed(2), w)).join(''));
console.log(pad('cost USD', 24) + runs.map(r => pad(r.d.costUsd.toFixed(2), w)).join(''));
console.log(pad('seconds', 24) + runs.map(r => pad(r.d.durationSeconds, w)).join(''));
console.log(pad('partial', 24) + runs.map(r => pad(r.d.partial ? (r.d.partialReason || 'yes') : 'no', w)).join(''));
console.log('\nper run (turns, seconds, USD, Agent calls at any level of the tree):');
for (const c of cases) for (const r of runs) {
  const x = r.d.cases.find(k => k.name === c); if (!x) continue;
  (x.arms.with || []).forEach((run, i) => console.log(`  ${pad(c, 22)} ${pad(r.name, w)} run${i}: turns=${run.turns} sec=${run.durationSeconds} usd=${run.costUsd.toFixed(2)} ${run.error ? 'error=' + run.error : ''} agents: ${fmt(agentMix(run.tracePath, path.join(out, r.name, 'traces', `${c}-run${i}.jsonl`)))}`));
}
// The kept sandboxes hold the plugin's HOME and workspace; the trace has been read, so drop them.
for (const k of kept) { try { fs.chmodSync(k, 0o700); for (const sub of ['sealed']) { const p = path.join(k, sub); if (fs.existsSync(p)) fs.chmodSync(p, 0o700); } fs.rmSync(k, { recursive: true, force: true }); } catch (e) { console.log(`(could not remove ${k}: ${e.message})`); } }
console.log(`\nresults: ${out}`);
JS
