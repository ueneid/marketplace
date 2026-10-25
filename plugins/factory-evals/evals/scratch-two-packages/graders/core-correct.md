---
type: llm
weight: 3
focus: { source: file, path: packages/core/src/index.js }
---
Reading the code: levenshtein("kitten", "sitting") would be 3, levenshtein("", "abc") would be 3, similarity("abc", "abc") would be 1, and similarity("", "") would be 1 (not NaN). Fail if any would be wrong.
