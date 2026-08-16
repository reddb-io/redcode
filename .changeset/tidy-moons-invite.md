---
"opencode": patch
---

Prefer `redcode.json` / `redcode.jsonc` for global and project configuration, keeping `opencode.json` / `opencode.jsonc` as a fallback.

The global config directory is already `~/.config/redcode/`, but the file inside it was still OpenCode-named. Both names are now read everywhere, in every scope. Existing configs keep working with no migration and no warning: when a directory holds both names they are merged exactly the way `opencode.json` and `opencode.jsonc` already merge, with the Redcode-named file winning the fields they share. Directory proximity still outranks the file name, so a nested `opencode.json` beats a `redcode.json` further up.

Files are never created beside an existing config. A global config or an `opencode mcp add` target is only written under the Redcode name when no config exists at all; otherwise the file already on disk is edited in place.

The `customize-opencode` skill no longer points the agent at `~/.config/opencode/`, which has not been the config directory since the directory rename.
