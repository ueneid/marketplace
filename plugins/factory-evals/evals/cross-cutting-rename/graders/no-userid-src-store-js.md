---
type: regex
pattern: "userId"
match: not_contains
target: { source: file, path: src/store.js }
weight: 1
---
