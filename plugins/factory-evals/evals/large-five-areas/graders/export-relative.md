---
type: regex
pattern: "export\\s+(async\\s+)?function\\s+relative\\b|export\\s*\\{[^}]*\\brelative\\b"
target: { source: file, path: src/notify/format.js }
weight: 1
---
