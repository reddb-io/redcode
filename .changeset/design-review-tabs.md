---
"@reddb-io/redcode": patch
---

Design review opens at most one browser tab per review. The Design tool, the TUI's Open Design review and `redcode design` all claim the launch through the server, which counts connected review pages (including an open app review panel): a publish while a page is connected opens nothing and the page live-reloads, rapid publishes or a publish right after an explicit open open one tab, a failed launch is retried on the next publish, and a closed tab is reopened only after a short debounce. The tool result says whether a tab was requested instead of claiming one opened. `REDCODE_NO_BROWSER` now stops every browser launch (Design review, MCP OAuth, account login, plugin OAuth), and test suites set it.
