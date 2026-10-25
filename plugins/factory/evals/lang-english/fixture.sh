#!/usr/bin/env bash
set -euo pipefail
cat > package.json <<'JSON'
{ "name": "lang-english", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > text.js <<'JS'
export function capitalize(s) {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}
JS
cat > text.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capitalize } from './text.js';
test('capitalize touches only the first letter', () => {
  assert.equal(capitalize('hello'), 'Hello');
  assert.equal(capitalize('hELLO'), 'HELLO');
  assert.equal(capitalize(''), '');
});
JS
git init -q -b main
git -c user.name=fixture -c user.email=fixture@example.invalid add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "fixture"
