#!/usr/bin/env bash
set -euo pipefail
cat > package.json <<'JSON'
{ "name": "three-areas", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }
JSON
mkdir -p src test
cat > src/price.js <<'JS'
// Price with 10% tax, rounded to whole yen (round half up).
export function withTax(price) {
  return Math.floor(price * 1.1);
}
JS
cat > src/slug.js <<'JS'
// URL slug: lower-case, spaces to hyphens, drop everything else.
export function slugify(s) {
  return s.toLowerCase().replace(/\s+/g, '-');
}
JS
cat > src/dates.js <<'JS'
// Days between two ISO dates (end exclusive). Always >= 0.
export function daysBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return ms / 86400000;
}
JS
cat > test/price.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTax } from '../src/price.js';
test('withTax rounds half up', () => {
  assert.equal(withTax(100), 110);
  assert.equal(withTax(105), 116); // 115.5 -> 116
});
JS
cat > test/slug.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slug.js';
test('slugify drops punctuation', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('Hello, World!'), 'hello-world');
});
JS
cat > test/dates.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween } from '../src/dates.js';
test('daysBetween is never negative', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-04'), 3);
  assert.equal(daysBetween('2026-01-04', '2026-01-01'), 3);
});
JS
git init -q -b main
git -c user.name=fixture -c user.email=fixture@example.invalid add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "fixture"
