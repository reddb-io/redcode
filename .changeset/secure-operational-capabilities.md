---
"@reddb-io/redcode": patch
---

Expose operational agent capabilities with their execution target and readiness, upgrade the managed Computer Use integration, and require risk-specific approval for browser observation, navigation, interaction, files, evaluation and profiling.

Attribute plugin-provided capabilities automatically, group equivalent providers without collapsing their execution targets, and expose server plugin health, package updates and native Desktop extension state in Settings.

Show the same plugin provenance and execution targets from the TUI Agent tools dialog and `redcode tools list`, while retaining compatibility with servers that do not yet advertise capabilities.

Harden browser execution by serializing attachment handshakes and permission replacement, pinning validated DNS results, requiring an explicit session grant for private and local network hosts, and releasing completed or interrupted tunnel capacity reliably.
