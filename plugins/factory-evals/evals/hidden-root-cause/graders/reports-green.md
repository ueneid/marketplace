---
type: llm
weight: 1
---
The final message names src/money.js as the file that was changed, explains that the cause was rounding in yen() (it floors instead of rounding half up), and states that `node --test` passes. A message that patches cart.js, line.js or the test instead fails.
