---
'playwriter': patch
---

Add `PLAYWRITER_EXEC_TIMEOUT` environment variable to set the default execution timeout (ms) for CLI `-e`/`-f` and the MCP `execute` tool.

Explicit `--timeout` (CLI) or `timeout` (MCP tool argument) still overrides the env default. Internal CDP/infrastructure timeouts are unchanged.

```bash
export PLAYWRITER_EXEC_TIMEOUT=30000
playwriter -s 1 -e 'await page.goto("https://slow.example")'
```

Fixes #102
