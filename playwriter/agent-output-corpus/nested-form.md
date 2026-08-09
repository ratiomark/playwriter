# Deterministic Nested Form

This comparison mirrors the nested form fixture from `aria-snapshot.unit.test.ts`.
Both outputs come from the same Playwriter executor, page, accessibility extraction, and renderer.

## Upstream Playwriter CLI Output

```text
Console output:
[log]     - form "Account":
      - labeltext:
        - text: "Email"
        - textbox "Email" [data-testid="email-input"]
      - button "Save" [id="save-primary"]
      - button "Save" [id="save-secondary"]

use refToLocator({ ref: 'e3' }) to get locators for ref strings.
```

## Relay Structured Result

```json
{
  "agentText": "- form \"Account\":\n  - labeltext:\n    - text: \"Email\"\n    - textbox \"Email\" [data-testid=\"email-input\"]\n  - button \"Save\" [id=\"save-primary\"]\n  - button \"Save\" [id=\"save-secondary\"]\n\nuse refToLocator({ ref: 'e3' }) to get locators for ref strings.",
  "consoleEvents": [
    {
      "method": "log",
      "text": "- form \"Account\":\n  - labeltext:\n    - text: \"Email\"\n    - textbox \"Email\" [data-testid=\"email-input\"]\n  - button \"Save\" [id=\"save-primary\"]\n  - button \"Save\" [id=\"save-secondary\"]\n\nuse refToLocator({ ref: 'e3' }) to get locators for ref strings."
    }
  ],
  "returnValue": {
    "snapshot": "- form \"Account\":\n  - labeltext:\n    - text: \"Email\"\n    - textbox \"Email\" [data-testid=\"email-input\"]\n  - button \"Save\" [id=\"save-primary\"]\n  - button \"Save\" [id=\"save-secondary\"]\n\nuse refToLocator({ ref: 'e3' }) to get locators for ref strings."
  }
}
```

## Candidate ATM Agent Output

```text
- form "Account":
  - labeltext:
    - text: "Email"
    - textbox "Email" [data-testid="email-input"]
  - button "Save" [id="save-primary"]
  - button "Save" [id="save-secondary"]

use refToLocator({ ref: 'e3' }) to get locators for ref strings.
```
