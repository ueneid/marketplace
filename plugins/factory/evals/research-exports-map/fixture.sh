#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > package.json <<'JSON'
{ "name": "@scratch/typing-core", "version": "0.1.0", "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > src/index.js <<'JS'
export function score(expected, typed) { return expected === typed ? 1 : 0; }
JS
cat > src/index.d.ts <<'TS'
export function score(expected: string, typed: string): number;
TS
cat > src/ja.js <<'JS'
export const kana = ['あ', 'い', 'う'];
JS
cat > src/ja.d.ts <<'TS'
export const kana: string[];
TS
cat > src/index.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from './index.js';
test('score', () => { assert.equal(score('a', 'a'), 1); });
JS
git init -q -b main
git -c user.name=fixture -c user.email=fixture@example.invalid add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "fixture"
