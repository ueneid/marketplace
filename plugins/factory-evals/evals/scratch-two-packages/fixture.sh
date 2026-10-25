#!/usr/bin/env bash
set -euo pipefail
printf '# scratch\n\n(empty)\n' > README.md
git init -q -b main
git -c user.name=fixture -c user.email=fixture@example.invalid add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "fixture"
