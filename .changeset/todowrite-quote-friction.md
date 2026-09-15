---
"@reddb-io/redcode": patch
---

Stop `todowrite` from failing over and over in fresh sessions. The task gate now reads a legacy session's user requests and tool results even after the session gains a projected context update or agent switch, which used to hide all of them. A requirement that retypes the request with different whitespace, quote marks, accents, case or an ellipsis matches it, and a paraphrase attaches the latest request and keeps the wording as the criterion. Completing a task still requires real evidence. Refusals now say how to fix the call, are logged at WARN with their kind, and the folded "Todo update failed" row shows the latest error, expands to every error in the run and copies them.
