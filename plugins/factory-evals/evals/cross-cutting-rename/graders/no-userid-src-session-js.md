---
type: regex
pattern: "userId"
match: not_contains
target: { source: file, path: src/session.js }
weight: 1
---
