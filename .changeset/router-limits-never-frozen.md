---
"@reddb-io/redcode": patch
---

A model selected through a saved RedRouter or 9Router connection no longer keeps a guessed context window. The connection's saved catalog now holds only the limits the router reported; a limit the router left out follows the current models catalog every time the model is loaded, so a catalog refresh reaches saved selections without waiting for the router's list to change, and a guess frozen by an earlier version heals on load. A limit set in configuration under `providers.<id>.models.<id>.limit` now also applies to a model resolved through a saved connection.
