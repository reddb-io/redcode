---
"@reddb-io/redcode": patch
---

`/setup` no longer stops at "Test and save" with "Generative connection checked" shown as an error: the S2 connection test gives reasoning models (Opus 5.5, GPT-6, Fable) room to answer, accepts a response that ends at the length limit, and reports the real reason when the connection fails.
