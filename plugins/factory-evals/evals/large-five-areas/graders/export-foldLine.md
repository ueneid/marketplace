---
type: regex
pattern: "export\\s+(async\\s+)?function\\s+foldLine\\b|export\\s*\\{[^}]*\\bfoldLine\\b"
target: { source: file, path: src/calendar/ical.js }
weight: 1
---
