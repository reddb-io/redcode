---
"@reddb-io/redcode": patch
---

Blocking dialogs can always be left. If the server doesn't answer a question or permission reply within 10 seconds, the dialog closes and explains how to retry. Pressing Ctrl+C a second time within 5 seconds exits even while a dismiss is still pending. Permission replies now report failures instead of ignoring them.

Time spent reading a plan approval no longer counts against the tool deadline. Before, taking longer than the deadline to answer stopped plan_exit and left the approval dialog answering a request that had already failed.
