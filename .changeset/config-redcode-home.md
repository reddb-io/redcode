---
"opencode": patch
---

Move the global config directory from `~/.config/redcode/` to the RedDB family at `~/.red/redcode/` and rename the global config file to `config.jsonc` (with `config.json` as an alias). The XDG directory is still read as a fallback so existing installs keep working without manual migration; the transitional `redcode.json` / `redcode.jsonc` and the legacy `opencode.json` / `opencode.jsonc` names are still read everywhere the primary `config.*` name is, and the primary file always wins on merge.
