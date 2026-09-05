---
"@reddb-io/redcode": patch
"@reddb-io/redcode-core": patch
"@reddb-io/redcode-tui": patch
"@reddb-io/redcode-app": patch
"@reddb-io/redcode-ui": patch
---

Build is red, plan is gold, design is cyan — everywhere, including the loading bar

The brand theme had set primary, secondary and accent all to RedDB reds, and agents took their colour from that palette by position, so every mode looked the same. Each built-in agent now names its colour: build red, plan gold, design a cyan a shade under bright. The TUI's loading scanner takes its head from the agent's own colour instead of the theme accent, so it changes with the mode again. The app gets a design token to match.
