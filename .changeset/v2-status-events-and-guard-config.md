---
"@reddb-io/redcode-schema": minor
"@reddb-io/redcode-core": minor
"@reddb-io/redcode": minor
---

v2 SDK clients now receive `session.status`, and the v2 runner reads the guard config keys.

- **Status on the v2 event stream:** `session.status` is part of the v2 event protocol. It carries the same busy (with phase, tool, step and since), retry and idle shapes as legacy. `/api/event` used to skip these events, so SDK Next clients could not tell a busy session from an idle one. The deprecated `session.idle` event stays legacy-only.
- **Guard config in v2:** `experimental.loop_guard`, `experimental.tool_timeout` and `experimental.turn_stall` are now valid in v2 config. The v2 runner (used by `redcode design`) applies them per turn, exactly as the legacy runtime does. Setting `false` turns a guard off. Without these keys, v2 keeps the legacy defaults.
