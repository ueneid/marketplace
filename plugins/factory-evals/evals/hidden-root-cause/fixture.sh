#!/usr/bin/env bash
set -euo pipefail
cat > package.json <<'JSON'
{ "name": "hidden-root-cause", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }
JSON
mkdir -p src test
cat > src/money.js <<'JS'
// Whole yen from a float amount. Yen has no minor unit, so this rounds to the
// nearest integer, half up.
export function yen(amount) {
  return Math.floor(amount);
}
JS
cat > src/line.js <<'JS'
import { yen } from './money.js';
// A cart line: unit price times quantity, with the discount rate applied.
export function lineTotal({ price, qty, discount = 0 }) {
  return yen(price * qty * (1 - discount));
}
JS
cat > src/cart.js <<'JS'
import { lineTotal } from './line.js';
export function cartTotal(lines) {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0);
}
JS
cat > test/cart.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.js';
test('cart total rounds each line half up', () => {
  // 2.5 and 0.5 must round half up (3 and 1), not down (2 and 0).
  assert.equal(cartTotal([{ price: 1, qty: 5, discount: 0.5 }, { price: 0.5, qty: 1 }]), 4);
});
JS
cat > test/money.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yen } from '../src/money.js';
test('yen gives whole numbers', () => {
  assert.equal(yen(10.4), 10);
  assert.equal(yen(10), 10);
});
JS
git init -q -b main
git -c user.name=fixture -c user.email=fixture@example.invalid add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "fixture"
