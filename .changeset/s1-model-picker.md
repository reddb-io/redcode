---
"@reddb-io/redcode": patch
---

Choosing the System One evaluator in `/setup` now lists every S1 model you can use right away, so you no longer type a model name. The list shows each model your RedRouter serves as `RedRouter · <upstream> · <model>` with its full routed id (the router's recommendation first), then S1 offers from directly connected providers (OpenRouter, Cloudflare AI Gateway, Vercel, Vivgrid, NanoGPT, TypeSafe), then OpenCode Zen's free Jev. Picking one sets the connection, address, credential and model together. "Enter model manually…" is the last option and leads through connection, address, key and model id. If the RedRouter's model list can't be read, the picker says why (rejected credential, HTTP status, unreachable address) and offers Retry instead of dropping you into a blank model prompt. A RedRouter connected under a custom provider id now works as an S1 connection. S1 labels use the same `Provider · Model` format as S2.
