# @reddb-io/redcode-ui

## 1.18.19

### Patch Changes

- be2fcd5: Build is red, plan is gold, design is cyan — everywhere, including the loading bar

  The brand theme had set primary, secondary and accent all to RedDB reds, and agents took their colour from that palette by position, so every mode looked the same. Each built-in agent now names its colour: build red, plan gold, design a cyan a shade under bright. The TUI's loading scanner takes its head from the agent's own colour instead of the theme accent, so it changes with the mode again. The app gets a design token to match.

- 2b6e24e: Ported from upstream: ten app and ui fixes

  Server details stay editable; file search results are preserved while loading; the archive-session command is registered in both layouts and archived sessions leave the home list at once; model provider headers stay visible; focus is restored in stacked dialogs; session rename and tab menu fixes; the open-in icon is larger; desktop identifies itself in device auth; and happy-dom is bumped to the version that fixes the GC-dependent MutationObserver flake.
