---
"opencode": patch
---

Stop reading the legacy `~/.config/redcode/` XDG directory. Global config now comes only from `~/.red/redcode/` (`config.jsonc` primary, `redcode.*` / `opencode.*` still merged beneath it). Stale generated files left in the XDG directory — e.g. a `provider.minimax` block pointing at the dead `api.minimax.chat` endpoint — no longer leak into the merged config.
