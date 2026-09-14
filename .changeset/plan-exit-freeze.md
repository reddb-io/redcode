---
"@reddb-io/redcode": patch
---

Plan approval no longer leaves an unanswerable dialog. When the server no longer has a question (its turn was interrupted, or the instance reloaded), answering or dismissing it now removes the dialog and says why. Before, the failure was silently ignored, so Enter, Esc and Ctrl+C all appeared to do nothing and the only way out was to kill the terminal. The v2 runtime now also tells clients when a pending question ends without an answer.
