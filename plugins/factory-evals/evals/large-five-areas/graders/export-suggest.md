---
type: regex
pattern: "export\\s+(async\\s+)?function\\s+suggest\\b|export\\s*\\{[^}]*\\bsuggest\\b"
target: { source: file, path: src/inventory/packing.js }
weight: 1
---
