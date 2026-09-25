---
"@reddb-io/redcode": patch
---

RedRouter flat models: an offer switched off for a flat id is shown greyed with "off" and can still be pinned by its `pin_id`. A flat model whose offers are in a custom order says "custom order" in the pickers. A saved model the router no longer lists (for example a flat id whose offers were all switched off) now falls back with a message saying why, in the TUI and in the session error, instead of switching silently.
