---
type: llm
weight: 2
focus: { source: file, path: src/duration.js }
---
Reading the code, parseDuration("1h30m") would return 5400, parseDuration("45s") would return 45, parseDuration("2h") would return 7200, and parseDuration("abc") or parseDuration("") would throw rather than return NaN or 0. Fail if any of these would be wrong.
