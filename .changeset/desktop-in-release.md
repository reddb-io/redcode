---
"@reddb-io/redcode": minor
---

Redcode Desktop now installs with Redcode. Every archive (except Linux musl) carries the desktop app beside `redcode`, and npm installs the matching `@reddb-io/redcode-desktop-<os>-<arch>` package. `redcode desktop` opens it and registers its shortcut and the `redcode://` link handler on first launch. The desktop runs the `redcode` of its own installation and updates with `redcode upgrade`, which updates the CLI, the design app and the desktop together.
