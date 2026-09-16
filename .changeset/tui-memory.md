---
"@reddb-io/redcode": minor
---

Each Redcode tab uses less memory, and `redcode debug memory` shows where it goes.

- **About 150 MB less per TUI.** A tab measured 696 MB (proportional set size) after boot, 782 MB after a session with tool calls and 683 MB after ten idle minutes; it is now 553 MB, 604 MB and 527 MB. The peak during a session fell from 968 MB to 737 MB, and `redcode serve` boots in 213 MB instead of 315 MB.
- **Services are built once.** The service graph is shared: a service many others depend on was compiled once but built again for every path that reached it, about a hundred thousand throwaway scopes and fibers when a project opened. Each service is now built once per project, which also shortens startup work.
- **The TUI keeps only what it shows from the provider list.** The list carries every model of every catalog provider (6 MB of JSON); the TUI keeps provider ids, names and credential variable names.
- **Babel loads when a TUI plugin needs it.** The Solid transform for plugin files no longer loads Babel at startup.
- **SQLite's page cache is 8 MB per process instead of 64 MB.** File pages are already cached by the operating system and shared by every process; on a large database the private cache added up to 87 MB per tab without making queries faster.
- **`redcode debug memory [pid]`** lists running redcode processes with resident and proportional memory, swap, threads and child processes (language servers, MCP servers), and asks each TUI or `redcode serve` from this version for the JavaScript heap of every thread and the size of its caches. Processes started by an older version are listed but never signalled.
