---
"@reddb-io/redcode": minor
---

Restore self-update for mise installs of `github:reddb-io/redcode`: `redcode upgrade` and automatic updates move the mise pin, confirm the new version is the active one, and explain when mise's `minimum_release_age` holds a release back. Honor every `REDCODE_*` environment variable as an alias of its `OPENCODE_*` name, and load `config.jsonc`, `config.json` and `redcode.json(c)` from `~/.red/code` again, above `opencode.json(c)`.
