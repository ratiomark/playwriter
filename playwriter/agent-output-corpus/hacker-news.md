# Hacker News Interactive Tree

This comparison reuses the Hacker News case from `relay-core.test.ts`.
Both outputs come from the same Playwriter executor, page, accessibility extraction, and renderer.

## Upstream Playwriter CLI Output

```text
Console output:
[log]           - role=link
          - role=link[name="Hacker News"]
          - role=link[name="new"]
          - role=link[name="past"] >> nth=0
          - role=link[name="comments"]
          - role=link[name="ask"]
          - role=link[name="show"]
          - role=link[name="jobs"]
          - role=link[name="submit"]
          - role=link[name="login"]
          - link [id="up_1"]
          - role=link[name="Y Combinator"]
          - role=link[name="ycombinator.com"]
          - role=link[name="pg"] >> nth=0
          - role=link[name="on Oct 9, 2006"] >> nth=0
          - role=link[name="hide"]
          - role=link[name="past"] >> nth=1
          - role=link[name="favorite"]
          - role=link[name="3 comments"]
            - link [id="up_15"]
            - role=link[name="sama"]
            - role=link[name="on Oct 9, 2006"] >> nth=1
            - link "[–]" [id="15"]
            - link [id="up_17"]
            - role=link[name="pg"] >> nth=1
            - role=link[name="on Oct 9, 2006"] >> nth=2
            - link "[–]" [id="17"]
            - link [id="up_1079"]
            - role=link[name="dmon"]
            - role=link[name="on Feb 25, 2007"]
            - link "[–]" [id="1079"]
        - role=link[name="Consider applying for YC's Fall 2026 batch! Applications are open till July 27."]
          - role=link[name="Guidelines"]
          - role=link[name="FAQ"]
          - role=link[name="Lists"]
          - role=link[name="API"]
          - role=link[name="Security"]
          - role=link[name="Legal"]
          - role=link[name="Apply to YC"]
          - role=link[name="Contact"]
          - role=textbox
  - role=button[name="Pin element — click any element to copy inspection code for a playwriter -e call"]
  - role=button[name="Close Playwriter toolbar"]

use refToLocator({ ref: 'e3' }) to get locators for ref strings.
```

## Relay Structured Result

```json
{
  "agentText": "- role=link\n- role=link[name=\"Hacker News\"]\n- role=link[name=\"new\"]\n- role=link[name=\"past\"] >> nth=0\n- role=link[name=\"comments\"]\n- role=link[name=\"ask\"]\n- role=link[name=\"show\"]\n- role=link[name=\"jobs\"]\n- role=link[name=\"submit\"]\n- role=link[name=\"login\"]\n- link [id=\"up_1\"]\n- role=link[name=\"Y Combinator\"]\n- role=link[name=\"ycombinator.com\"]\n- role=link[name=\"pg\"] >> nth=0\n- role=link[name=\"on Oct 9, 2006\"] >> nth=0\n- role=link[name=\"hide\"]\n- role=link[name=\"past\"] >> nth=1\n- role=link[name=\"favorite\"]\n- role=link[name=\"3 comments\"]\n- link [id=\"up_15\"]\n- role=link[name=\"sama\"]\n- role=link[name=\"on Oct 9, 2006\"] >> nth=1\n- link \"[–]\" [id=\"15\"]\n- link [id=\"up_17\"]\n- role=link[name=\"pg\"] >> nth=1\n- role=link[name=\"on Oct 9, 2006\"] >> nth=2\n- link \"[–]\" [id=\"17\"]\n- link [id=\"up_1079\"]\n- role=link[name=\"dmon\"]\n- role=link[name=\"on Feb 25, 2007\"]\n- link \"[–]\" [id=\"1079\"]\n- role=link[name=\"Consider applying for YC's Fall 2026 batch! Applications are open till July 27.\"]\n- role=link[name=\"Guidelines\"]\n- role=link[name=\"FAQ\"]\n- role=link[name=\"Lists\"]\n- role=link[name=\"API\"]\n- role=link[name=\"Security\"]\n- role=link[name=\"Legal\"]\n- role=link[name=\"Apply to YC\"]\n- role=link[name=\"Contact\"]\n- role=textbox\n- role=button[name=\"Pin element — click any element to copy inspection code for a playwriter -e call\"]\n- role=button[name=\"Close Playwriter toolbar\"]\n\nuse refToLocator({ ref: 'e3' }) to get locators for ref strings.",
  "consoleEvents": [
    {
      "method": "log",
      "text": "- role=link\n- role=link[name=\"Hacker News\"]\n- role=link[name=\"new\"]\n- role=link[name=\"past\"] >> nth=0\n- role=link[name=\"comments\"]\n- role=link[name=\"ask\"]\n- role=link[name=\"show\"]\n- role=link[name=\"jobs\"]\n- role=link[name=\"submit\"]\n- role=link[name=\"login\"]\n- link [id=\"up_1\"]\n- role=link[name=\"Y Combinator\"]\n- role=link[name=\"ycombinator.com\"]\n- role=link[name=\"pg\"] >> nth=0\n- role=link[name=\"on Oct 9, 2006\"] >> nth=0\n- role=link[name=\"hide\"]\n- role=link[name=\"past\"] >> nth=1\n- role=link[name=\"favorite\"]\n- role=link[name=\"3 comments\"]\n- link [id=\"up_15\"]\n- role=link[name=\"sama\"]\n- role=link[name=\"on Oct 9, 2006\"] >> nth=1\n- link \"[–]\" [id=\"15\"]\n- link [id=\"up_17\"]\n- role=link[name=\"pg\"] >> nth=1\n- role=link[name=\"on Oct 9, 2006\"] >> nth=2\n- link \"[–]\" [id=\"17\"]\n- link [id=\"up_1079\"]\n- role=link[name=\"dmon\"]\n- role=link[name=\"on Feb 25, 2007\"]\n- link \"[–]\" [id=\"1079\"]\n- role=link[name=\"Consider applying for YC's Fall 2026 batch! Applications are open till July 27.\"]\n- role=link[name=\"Guidelines\"]\n- role=link[name=\"FAQ\"]\n- role=link[name=\"Lists\"]\n- role=link[name=\"API\"]\n- role=link[name=\"Security\"]\n- role=link[name=\"Legal\"]\n- role=link[name=\"Apply to YC\"]\n- role=link[name=\"Contact\"]\n- role=textbox\n- role=button[name=\"Pin element — click any element to copy inspection code for a playwriter -e call\"]\n- role=button[name=\"Close Playwriter toolbar\"]\n\nuse refToLocator({ ref: 'e3' }) to get locators for ref strings."
    }
  ],
  "returnValue": {
    "snapshot": "- role=link\n- role=link[name=\"Hacker News\"]\n- role=link[name=\"new\"]\n- role=link[name=\"past\"] >> nth=0\n- role=link[name=\"comments\"]\n- role=link[name=\"ask\"]\n- role=link[name=\"show\"]\n- role=link[name=\"jobs\"]\n- role=link[name=\"submit\"]\n- role=link[name=\"login\"]\n- link [id=\"up_1\"]\n- role=link[name=\"Y Combinator\"]\n- role=link[name=\"ycombinator.com\"]\n- role=link[name=\"pg\"] >> nth=0\n- role=link[name=\"on Oct 9, 2006\"] >> nth=0\n- role=link[name=\"hide\"]\n- role=link[name=\"past\"] >> nth=1\n- role=link[name=\"favorite\"]\n- role=link[name=\"3 comments\"]\n- link [id=\"up_15\"]\n- role=link[name=\"sama\"]\n- role=link[name=\"on Oct 9, 2006\"] >> nth=1\n- link \"[–]\" [id=\"15\"]\n- link [id=\"up_17\"]\n- role=link[name=\"pg\"] >> nth=1\n- role=link[name=\"on Oct 9, 2006\"] >> nth=2\n- link \"[–]\" [id=\"17\"]\n- link [id=\"up_1079\"]\n- role=link[name=\"dmon\"]\n- role=link[name=\"on Feb 25, 2007\"]\n- link \"[–]\" [id=\"1079\"]\n- role=link[name=\"Consider applying for YC's Fall 2026 batch! Applications are open till July 27.\"]\n- role=link[name=\"Guidelines\"]\n- role=link[name=\"FAQ\"]\n- role=link[name=\"Lists\"]\n- role=link[name=\"API\"]\n- role=link[name=\"Security\"]\n- role=link[name=\"Legal\"]\n- role=link[name=\"Apply to YC\"]\n- role=link[name=\"Contact\"]\n- role=textbox\n- role=button[name=\"Pin element — click any element to copy inspection code for a playwriter -e call\"]\n- role=button[name=\"Close Playwriter toolbar\"]\n\nuse refToLocator({ ref: 'e3' }) to get locators for ref strings."
  }
}
```

## Candidate ATM Agent Output

```text
- role=link
- role=link[name="Hacker News"]
- role=link[name="new"]
- role=link[name="past"] >> nth=0
- role=link[name="comments"]
- role=link[name="ask"]
- role=link[name="show"]
- role=link[name="jobs"]
- role=link[name="submit"]
- role=link[name="login"]
- link [id="up_1"]
- role=link[name="Y Combinator"]
- role=link[name="ycombinator.com"]
- role=link[name="pg"] >> nth=0
- role=link[name="on Oct 9, 2006"] >> nth=0
- role=link[name="hide"]
- role=link[name="past"] >> nth=1
- role=link[name="favorite"]
- role=link[name="3 comments"]
- link [id="up_15"]
- role=link[name="sama"]
- role=link[name="on Oct 9, 2006"] >> nth=1
- link "[–]" [id="15"]
- link [id="up_17"]
- role=link[name="pg"] >> nth=1
- role=link[name="on Oct 9, 2006"] >> nth=2
- link "[–]" [id="17"]
- link [id="up_1079"]
- role=link[name="dmon"]
- role=link[name="on Feb 25, 2007"]
- link "[–]" [id="1079"]
- role=link[name="Consider applying for YC's Fall 2026 batch! Applications are open till July 27."]
- role=link[name="Guidelines"]
- role=link[name="FAQ"]
- role=link[name="Lists"]
- role=link[name="API"]
- role=link[name="Security"]
- role=link[name="Legal"]
- role=link[name="Apply to YC"]
- role=link[name="Contact"]
- role=textbox
- role=button[name="Pin element — click any element to copy inspection code for a playwriter -e call"]
- role=button[name="Close Playwriter toolbar"]

use refToLocator({ ref: 'e3' }) to get locators for ref strings.
```
