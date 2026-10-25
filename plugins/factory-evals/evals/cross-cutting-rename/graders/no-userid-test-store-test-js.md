---
type: regex
pattern: "userId"
match: not_contains
target: { source: file, path: test/store.test.js }
weight: 1
---
