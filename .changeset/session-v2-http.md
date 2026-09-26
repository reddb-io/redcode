---
"@reddb-io/redcode": patch
---

Expose the V2 session runtime over HTTP (phase 1 of the V2 cutover): new experimental routes under `/experimental/session-v2` — prompt (durable admission), session read, messages, durable events and interrupt — served by `SessionV2.Service` directly, with the legacy SDK regenerated to cover them. The product still runs on the V1 loop; no client behavior changes yet.
