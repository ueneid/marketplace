#!/usr/bin/env bash
set -euo pipefail
cat > package.json <<'JSON'
{ "name": "cross-cutting-rename", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }
JSON
mkdir -p src test
cat > src/session.js <<'JS'
export function createSession(userId) {
  return { userId, createdAt: Date.now() };
}
JS
cat > src/store.js <<'JS'
const byUser = new Map();
export function save(session) {
  byUser.set(session.userId, session);
}
export function load(userId) {
  return byUser.get(userId) ?? null;
}
JS
cat > src/audit.js <<'JS'
export function auditLine(session, action) {
  return `${session.userId} ${action}`;
}
JS
cat > test/session.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/session.js';
test('createSession keeps the id', () => {
  assert.equal(createSession('u1').userId, 'u1');
});
JS
cat > test/store.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { save, load } from '../src/store.js';
import { createSession } from '../src/session.js';
test('save then load', () => {
  save(createSession('u2'));
  assert.equal(load('u2').userId, 'u2');
});
JS
cat > README.md <<'MD'
# sessions

`createSession(userId)` makes a session; `save` / `load(userId)` keep it in memory;
`auditLine(session, action)` formats `<userId> <action>`.
MD
git init -q -b main
git -c user.name=fixture -c user.email=fixture@example.invalid add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "fixture"
