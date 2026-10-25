---
type: regex
pattern: "userId"
match: not_contains
target: { source: file, path: test/session.test.js }
weight: 1
---
