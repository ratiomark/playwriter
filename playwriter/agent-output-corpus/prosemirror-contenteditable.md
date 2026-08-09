# ProseMirror Contenteditable

This comparison reuses the ProseMirror case from `aria-snapshot.test.ts`.
Both outputs come from the same Playwriter executor, page, accessibility extraction, and renderer.

## Upstream Playwriter CLI Output

```text
Console output:
[log]   - banner:
    - navigation:
      - role=link[name="ProseMirror"]
        - role=link[name="Examples"]
        - role=link[name="Documentation"]
        - role=link[name="Discuss"] >> nth=0
        - role=link[name="Code"]
      - role=button[name="Toggle strong style"]
      - role=button[name="Toggle emphasis"]
      - role=button[name="Toggle code font"]
      - role=button[name="Add or remove link"]
      - role=button[name="Insert"]
      - role=button[name="Type..."]
      - role=button[name="Undo last change"]
      - role=button[name="Redo last undone change"]
      - role=button[name="Wrap in bullet list"]
      - role=button[name="Wrap in ordered list"]
      - role=button[name="Wrap in block quote"]
      - role=button[name="⬚"]
      - textbox [contenteditable="true"]:
        - role=link[name="examples"] >> nth=0
  - role=link[name="Markdown"]
  - role=link[name="WYSIWYG"]
  - list:
    - listitem
    - listitem
    - listitem
    - listitem
    - listitem
    - listitem
  - role=link[name="open source"]
  - role=link[name="Start here."]
  - role=link[name="Forgejo"]
  - role=link[name="welcome"]
  - role=link[name="npm"]
  - role=link[name="examples"] >> nth=1
  - role=link[name="forum"]
  - role=link[name="issue tracker"]
  - role=link[name="code of conduct"]
  - role=link[name="crowd-funded"]
  - role=link[name="individuals and organizations"]
  - role=link[name="Posit"]
  - role=link[name="The New York Times"]
  - role=link[name="Tiptap"]
  - role=link[name="Progress"]
  - role=link[name="Scripto"]
  - role=link[name="Asana"]
  - role=link[name="BlockNote"]
  - role=link[name="Box"]
  - role=link[name="Desmos"]
  - role=link[name="Nextjournal"]
  - role=link[name="Plickers"]
  - role=link[name="The Guardian"]
  - role=link[name="Yarn"]
  - role=link[name="Fellow"]
  - role=link[name="Sunsama"]
  - contentinfo:
    - navigation:
      - role=link
        - role=link[name="Backers"]
        - role=link[name="Code of Conduct"]
        - role=link[name="Discuss"] >> nth=1
        - role=link[name="Report an Issue"]
  - role=button[name="Pin element — click any element to copy inspection code for a playwriter -e call"]
  - role=button[name="Close Playwriter toolbar"]

use refToLocator({ ref: 'e3' }) to get locators for ref strings.
```

## Relay Structured Result

```json
{
  "agentText": "- banner:\n  - navigation:\n    - role=link[name=\"ProseMirror\"]\n    - role=link[name=\"Examples\"]\n    - role=link[name=\"Documentation\"]\n    - role=link[name=\"Discuss\"] >> nth=0\n    - role=link[name=\"Code\"]\n  - role=button[name=\"Toggle strong style\"]\n  - role=button[name=\"Toggle emphasis\"]\n  - role=button[name=\"Toggle code font\"]\n  - role=button[name=\"Add or remove link\"]\n  - role=button[name=\"Insert\"]\n  - role=button[name=\"Type...\"]\n  - role=button[name=\"Undo last change\"]\n  - role=button[name=\"Redo last undone change\"]\n  - role=button[name=\"Wrap in bullet list\"]\n  - role=button[name=\"Wrap in ordered list\"]\n  - role=button[name=\"Wrap in block quote\"]\n  - role=button[name=\"⬚\"]\n  - textbox [contenteditable=\"true\"]:\n    - role=link[name=\"examples\"] >> nth=0\n- role=link[name=\"Markdown\"]\n- role=link[name=\"WYSIWYG\"]\n- list:\n  - listitem\n  - listitem\n  - listitem\n  - listitem\n  - listitem\n  - listitem\n- role=link[name=\"open source\"]\n- role=link[name=\"Start here.\"]\n- role=link[name=\"Forgejo\"]\n- role=link[name=\"welcome\"]\n- role=link[name=\"npm\"]\n- role=link[name=\"examples\"] >> nth=1\n- role=link[name=\"forum\"]\n- role=link[name=\"issue tracker\"]\n- role=link[name=\"code of conduct\"]\n- role=link[name=\"crowd-funded\"]\n- role=link[name=\"individuals and organizations\"]\n- role=link[name=\"Posit\"]\n- role=link[name=\"The New York Times\"]\n- role=link[name=\"Tiptap\"]\n- role=link[name=\"Progress\"]\n- role=link[name=\"Scripto\"]\n- role=link[name=\"Asana\"]\n- role=link[name=\"BlockNote\"]\n- role=link[name=\"Box\"]\n- role=link[name=\"Desmos\"]\n- role=link[name=\"Nextjournal\"]\n- role=link[name=\"Plickers\"]\n- role=link[name=\"The Guardian\"]\n- role=link[name=\"Yarn\"]\n- role=link[name=\"Fellow\"]\n- role=link[name=\"Sunsama\"]\n- contentinfo:\n  - navigation:\n    - role=link\n    - role=link[name=\"Backers\"]\n    - role=link[name=\"Code of Conduct\"]\n    - role=link[name=\"Discuss\"] >> nth=1\n    - role=link[name=\"Report an Issue\"]\n- role=button[name=\"Pin element — click any element to copy inspection code for a playwriter -e call\"]\n- role=button[name=\"Close Playwriter toolbar\"]\n\nuse refToLocator({ ref: 'e3' }) to get locators for ref strings.",
  "consoleEvents": [
    {
      "method": "log",
      "text": "- banner:\n  - navigation:\n    - role=link[name=\"ProseMirror\"]\n    - role=link[name=\"Examples\"]\n    - role=link[name=\"Documentation\"]\n    - role=link[name=\"Discuss\"] >> nth=0\n    - role=link[name=\"Code\"]\n  - role=button[name=\"Toggle strong style\"]\n  - role=button[name=\"Toggle emphasis\"]\n  - role=button[name=\"Toggle code font\"]\n  - role=button[name=\"Add or remove link\"]\n  - role=button[name=\"Insert\"]\n  - role=button[name=\"Type...\"]\n  - role=button[name=\"Undo last change\"]\n  - role=button[name=\"Redo last undone change\"]\n  - role=button[name=\"Wrap in bullet list\"]\n  - role=button[name=\"Wrap in ordered list\"]\n  - role=button[name=\"Wrap in block quote\"]\n  - role=button[name=\"⬚\"]\n  - textbox [contenteditable=\"true\"]:\n    - role=link[name=\"examples\"] >> nth=0\n- role=link[name=\"Markdown\"]\n- role=link[name=\"WYSIWYG\"]\n- list:\n  - listitem\n  - listitem\n  - listitem\n  - listitem\n  - listitem\n  - listitem\n- role=link[name=\"open source\"]\n- role=link[name=\"Start here.\"]\n- role=link[name=\"Forgejo\"]\n- role=link[name=\"welcome\"]\n- role=link[name=\"npm\"]\n- role=link[name=\"examples\"] >> nth=1\n- role=link[name=\"forum\"]\n- role=link[name=\"issue tracker\"]\n- role=link[name=\"code of conduct\"]\n- role=link[name=\"crowd-funded\"]\n- role=link[name=\"individuals and organizations\"]\n- role=link[name=\"Posit\"]\n- role=link[name=\"The New York Times\"]\n- role=link[name=\"Tiptap\"]\n- role=link[name=\"Progress\"]\n- role=link[name=\"Scripto\"]\n- role=link[name=\"Asana\"]\n- role=link[name=\"BlockNote\"]\n- role=link[name=\"Box\"]\n- role=link[name=\"Desmos\"]\n- role=link[name=\"Nextjournal\"]\n- role=link[name=\"Plickers\"]\n- role=link[name=\"The Guardian\"]\n- role=link[name=\"Yarn\"]\n- role=link[name=\"Fellow\"]\n- role=link[name=\"Sunsama\"]\n- contentinfo:\n  - navigation:\n    - role=link\n    - role=link[name=\"Backers\"]\n    - role=link[name=\"Code of Conduct\"]\n    - role=link[name=\"Discuss\"] >> nth=1\n    - role=link[name=\"Report an Issue\"]\n- role=button[name=\"Pin element — click any element to copy inspection code for a playwriter -e call\"]\n- role=button[name=\"Close Playwriter toolbar\"]\n\nuse refToLocator({ ref: 'e3' }) to get locators for ref strings."
    }
  ],
  "returnValue": {
    "snapshot": "- banner:\n  - navigation:\n    - role=link[name=\"ProseMirror\"]\n    - role=link[name=\"Examples\"]\n    - role=link[name=\"Documentation\"]\n    - role=link[name=\"Discuss\"] >> nth=0\n    - role=link[name=\"Code\"]\n  - role=button[name=\"Toggle strong style\"]\n  - role=button[name=\"Toggle emphasis\"]\n  - role=button[name=\"Toggle code font\"]\n  - role=button[name=\"Add or remove link\"]\n  - role=button[name=\"Insert\"]\n  - role=button[name=\"Type...\"]\n  - role=button[name=\"Undo last change\"]\n  - role=button[name=\"Redo last undone change\"]\n  - role=button[name=\"Wrap in bullet list\"]\n  - role=button[name=\"Wrap in ordered list\"]\n  - role=button[name=\"Wrap in block quote\"]\n  - role=button[name=\"⬚\"]\n  - textbox [contenteditable=\"true\"]:\n    - role=link[name=\"examples\"] >> nth=0\n- role=link[name=\"Markdown\"]\n- role=link[name=\"WYSIWYG\"]\n- list:\n  - listitem\n  - listitem\n  - listitem\n  - listitem\n  - listitem\n  - listitem\n- role=link[name=\"open source\"]\n- role=link[name=\"Start here.\"]\n- role=link[name=\"Forgejo\"]\n- role=link[name=\"welcome\"]\n- role=link[name=\"npm\"]\n- role=link[name=\"examples\"] >> nth=1\n- role=link[name=\"forum\"]\n- role=link[name=\"issue tracker\"]\n- role=link[name=\"code of conduct\"]\n- role=link[name=\"crowd-funded\"]\n- role=link[name=\"individuals and organizations\"]\n- role=link[name=\"Posit\"]\n- role=link[name=\"The New York Times\"]\n- role=link[name=\"Tiptap\"]\n- role=link[name=\"Progress\"]\n- role=link[name=\"Scripto\"]\n- role=link[name=\"Asana\"]\n- role=link[name=\"BlockNote\"]\n- role=link[name=\"Box\"]\n- role=link[name=\"Desmos\"]\n- role=link[name=\"Nextjournal\"]\n- role=link[name=\"Plickers\"]\n- role=link[name=\"The Guardian\"]\n- role=link[name=\"Yarn\"]\n- role=link[name=\"Fellow\"]\n- role=link[name=\"Sunsama\"]\n- contentinfo:\n  - navigation:\n    - role=link\n    - role=link[name=\"Backers\"]\n    - role=link[name=\"Code of Conduct\"]\n    - role=link[name=\"Discuss\"] >> nth=1\n    - role=link[name=\"Report an Issue\"]\n- role=button[name=\"Pin element — click any element to copy inspection code for a playwriter -e call\"]\n- role=button[name=\"Close Playwriter toolbar\"]\n\nuse refToLocator({ ref: 'e3' }) to get locators for ref strings."
  }
}
```

## Candidate ATM Agent Output

```text
- banner:
  - navigation:
    - role=link[name="ProseMirror"]
    - role=link[name="Examples"]
    - role=link[name="Documentation"]
    - role=link[name="Discuss"] >> nth=0
    - role=link[name="Code"]
  - role=button[name="Toggle strong style"]
  - role=button[name="Toggle emphasis"]
  - role=button[name="Toggle code font"]
  - role=button[name="Add or remove link"]
  - role=button[name="Insert"]
  - role=button[name="Type..."]
  - role=button[name="Undo last change"]
  - role=button[name="Redo last undone change"]
  - role=button[name="Wrap in bullet list"]
  - role=button[name="Wrap in ordered list"]
  - role=button[name="Wrap in block quote"]
  - role=button[name="⬚"]
  - textbox [contenteditable="true"]:
    - role=link[name="examples"] >> nth=0
- role=link[name="Markdown"]
- role=link[name="WYSIWYG"]
- list:
  - listitem
  - listitem
  - listitem
  - listitem
  - listitem
  - listitem
- role=link[name="open source"]
- role=link[name="Start here."]
- role=link[name="Forgejo"]
- role=link[name="welcome"]
- role=link[name="npm"]
- role=link[name="examples"] >> nth=1
- role=link[name="forum"]
- role=link[name="issue tracker"]
- role=link[name="code of conduct"]
- role=link[name="crowd-funded"]
- role=link[name="individuals and organizations"]
- role=link[name="Posit"]
- role=link[name="The New York Times"]
- role=link[name="Tiptap"]
- role=link[name="Progress"]
- role=link[name="Scripto"]
- role=link[name="Asana"]
- role=link[name="BlockNote"]
- role=link[name="Box"]
- role=link[name="Desmos"]
- role=link[name="Nextjournal"]
- role=link[name="Plickers"]
- role=link[name="The Guardian"]
- role=link[name="Yarn"]
- role=link[name="Fellow"]
- role=link[name="Sunsama"]
- contentinfo:
  - navigation:
    - role=link
    - role=link[name="Backers"]
    - role=link[name="Code of Conduct"]
    - role=link[name="Discuss"] >> nth=1
    - role=link[name="Report an Issue"]
- role=button[name="Pin element — click any element to copy inspection code for a playwriter -e call"]
- role=button[name="Close Playwriter toolbar"]

use refToLocator({ ref: 'e3' }) to get locators for ref strings.
```
