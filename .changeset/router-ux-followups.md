---
"@reddb-io/redcode": patch
---

A background RedRouter catalog refresh now reloads the providers of the running server, so the TUI and web model pickers show new, removed and renamed models right away instead of after a restart; a refresh that only changed limits updates the pickers without a toast. RedRouter's review mode is selectable as a variant (TUI variant picker and web) and requests the router's review id, a model served through another router shows `via RedRouter → <router>`, and the v2 provider and model APIs report the router connection and each model's upstream provider, earlier ids, modes and router variants.
