---
"opencode": patch
---

Add `redcode debug runtime`, which prints the composition the current location actually booted: the active Cordis profile and its ordered plugin IDs, the effective service topology derived from the compiled layer graph, and the runtime invariant report from boot readiness. Runtime invariants now return a typed result per owner instead of passing silently, and a failing owner is named while still failing boot. The payload carries identifiers only — no config values, credentials, paths, or environment.
