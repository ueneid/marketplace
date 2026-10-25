---
type: regex
pattern: "userId"
match: not_contains
target: { source: file, path: src/audit.js }
weight: 1
---
