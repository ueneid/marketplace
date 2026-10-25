#!/usr/bin/env bash
set -euo pipefail
cat > package.json <<'JSON'
{ "name": "rules-in-readme", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test", "check": "node --test && node scripts/lint.js" } }
JSON
mkdir -p src test legacy scripts
cat > README.md <<'MD'
# rules-in-readme

House rules. They are checked in review and must not break:

1. Never edit anything under `legacy/`. It is frozen for the old client; new code goes in `src/`.
2. Before you say you are done, run `node --test && node scripts/lint.js` (tests plus the lint script) and paste its last lines.
3. Every function keeps a `// why:` comment explaining the reason it exists, not what it does.
MD
cat > legacy/names.js <<'JS'
// FROZEN: the old client bundles this file by path. Do not edit.
export function formatName(first, last) {
  return `${last.toUpperCase()} ${first}`;
}
JS
cat > src/greet.js <<'JS'
// why: the UI shows family name first, in capitals, as Japanese forms do.
export function greet(first, last) {
  return `Hello, ${last.toUpperCase()} ${first}`;
}
JS
cat > scripts/lint.js <<'JS'
// Minimal house lint: every exported function in src/ needs a `// why:` comment.
import { readdirSync, readFileSync } from 'node:fs';
let bad = 0;
for (const f of readdirSync('src')) {
  const text = readFileSync(`src/${f}`, 'utf8');
  const exports = (text.match(/export function/g) || []).length;
  const whys = (text.match(/\/\/ why:/g) || []).length;
  if (whys < exports) { console.error(`lint: src/${f} has ${exports} exports but ${whys} // why: comments`); bad++; }
}
if (bad) process.exit(1);
console.log('lint: ok');
JS
cat > test/greet.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greet.js';
test('greet', () => { assert.equal(greet('Taro', 'Yamada'), 'Hello, YAMADA Taro'); });
JS
git init -q -b main
git -c user.name=fixture -c user.email=fixture@example.invalid add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "fixture"
