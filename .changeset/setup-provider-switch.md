---
"@reddb-io/redcode": patch
---

`/setup` lists every connected provider at the top of the S2 model step, so switching from RedRouter to OpenRouter (or connecting another provider) no longer hides at the end of a long model list. A failed "Test and save" now names the model and shows the provider's own message instead of raw nested JSON (for example `S2 model RedRouter / Go Model failed (HTTP 400): Upstream request failed: …`), offers "Change S2 model" next to "Back to S1 connection", and leaves the cursor on the option that fixes the failing role. The "Test and save" explanation now shows on its own line instead of being cut off.
