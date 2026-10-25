#!/usr/bin/env bash
set -euo pipefail
cat > package.json <<'JSON'
{ "name": "implied-edge-case", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }
JSON
mkdir -p src test
cat > src/duration.js <<'JS'
// Duration helpers.
JS
cat > README.md <<'MD'
# implied-edge-case

Helpers used by a scheduler. Bad input must never become a silent NaN or 0: the
scheduler would then run a job immediately. Throw instead.
MD
git init -q -b main
git -c user.name=fixture -c user.email=fixture@example.invalid add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "fixture"
