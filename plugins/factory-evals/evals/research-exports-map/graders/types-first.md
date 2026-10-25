---
type: llm
weight: 3
focus: { source: file, path: package.json }
---
The "exports" field has entries for "." and "./ja". In each entry the "types" condition is listed before "import" (Node resolves conditions in object order, so "types" must come first for TypeScript to pick it up), "types" points at the matching .d.ts under src/ and "import" at the matching .js. The JSON is valid. Fail if the order is wrong or a path does not exist in the fixture (src/index.js, src/index.d.ts, src/ja.js, src/ja.d.ts).
