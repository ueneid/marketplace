#!/usr/bin/env bash
# Builds the trial repo: three files, node:test, no dependencies.
set -euo pipefail
cat > package.json <<'JSON'
{
  "name": "factory-trial",
  "version": "1.0.0",
  "type": "module",
  "scripts": { "test": "node --test" }
}
JSON
cat > math.js <<'JS'
export function add(a, b) {
  return a - b;
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}
JS
cat > math.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, clamp } from './math.js';

test('add', () => {
  assert.equal(add(2, 3), 5);
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
});
JS
git init -q -b main
git -c user.name=fixture -c user.email=fixture@example.invalid add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "fixture: factory-trial"
