---
"@reddb-io/redcode": patch
---

Scope OpenTUI's runtime-module rewrite to TUI plugin modules. Host source loaded after a TUI plugin, such as the design store's React scaffold, no longer has bare `from "…"` specifiers rewritten into file URLs from the plugin's install, which on hoisted (Windows) installs sent design builds outside the application and stalled them on an `external_directory` prompt.
