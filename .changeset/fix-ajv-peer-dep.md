---
'playwriter': patch
---

Fix `Cannot find module 'ajv'` error when running via `npx`. The `@modelcontextprotocol/sdk` depends on `ajv-formats` which declares `ajv` as an optional peer dependency; npm/npx sometimes fails to hoist it correctly. Adding `ajv` as a direct dependency ensures it's always resolvable.

Fixes #95
