# Agent Output Corpus

This directory compares literal upstream Playwriter CLI output with relay return values and candidate ATM agent output from the same page state and accessibility implementation.

The focused corpus covers:

- a deterministic nested form based on `aria-snapshot.unit.test.ts`;
- the Hacker News interactive tree from `relay-core.test.ts`;
- the ProseMirror contenteditable case from `aria-snapshot.test.ts`.
- the GitHub dense UI case from `aria-snapshot.test.ts`.

`hacker-news-diagnostics.md` records filtered visible parent/children relationships, ignored-node indentation, and the original AX and DOM ancestor paths for representative Hacker News nodes.

The ATM candidate uses the upstream extraction and renderer. It removes indentation contributed by accessibility wrappers that are absent from the visible snapshot tree, preserves real visible nesting, and presents separate console events with one blank line between them.

Regenerate the focused corpus with:

```sh
PLAYWRITER_UPDATE_AGENT_OUTPUT_CORPUS=1 pnpm --filter playwriter exec vitest run src/agent-output-corpus.test.ts
```

Use the equivalent environment-variable syntax for your shell. Set `PLAYWRITER_BROWSER_PATH` when the default Playwright Chromium revision is not installed.
