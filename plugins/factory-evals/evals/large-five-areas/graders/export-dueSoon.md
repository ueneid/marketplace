---
type: regex
pattern: "export\\s+(async\\s+)?function\\s+dueSoon\\b|export\\s*\\{[^}]*\\bdueSoon\\b"
target: { source: file, path: src/tasks/task.js }
weight: 1
---
