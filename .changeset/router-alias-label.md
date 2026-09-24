---
"@reddb-io/redcode": patch
---

Fix the setup dialog showing a raw router alias id (e.g. `ocg/glm-5.3-flash`) instead of the model's display name when a saved System Two principal or fast model was saved under an id a router later renamed. The "Continue with…" label now resolves router aliases before reading the model's name, and both the System Two and System One "Continue with…"/summary labels use a consistent `Provider · Model` format.
