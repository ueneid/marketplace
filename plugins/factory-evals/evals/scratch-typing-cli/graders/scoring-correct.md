---
type: llm
weight: 3
focus: { source: file, path: src/score.js }
---
Reading the code: accuracy is the share of correctly typed characters as a percentage (an exact match gives 100, an empty attempt gives 0, and an attempt longer or shorter than the prompt does not throw or return NaN); WPM is computed from elapsed milliseconds with a stated convention (5 characters per word, or the formula is explained in a comment). Fail if any of these would be wrong.
