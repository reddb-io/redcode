# Redcode terminal design reference

The design source is the released `v0.57.0` tree, not the upstream default TUI.
Users work in terminal sessions with their own light/dark and contrast preferences.
Both built-in modes and custom themes must remain usable.

## Colors

| Role          | Dark      | Light     |
| ------------- | --------- | --------- |
| Brand / Build | `#ff2056` | `#ff2056` |
| Plan          | `#e3b341` | `#b8860b` |
| Design        | `#2ab3c8` | `#0e8ea3` |
| Question      | `#7fd88f` | `#3d9a57` |
| Text          | `#f4f5f7` | `#07080a` |
| Link          | `#ff6389` | `#ad163a` |

The historical source is `packages/tui/src/theme/index.ts` and
`theme/assets/reddb-tokens.json` at that tag. The current adapter is
`packages/tui/src/theme/assets/v2/redcode.json`. Components consume V2 semantic
tokens; agent colors use categorical identities and remain independent of list order.

## Structure and interaction

- Terminal typography follows the user's terminal font; no decorative display type.
- Start in a blank session. Do not insert a welcome/logo screen into normal startup.
- Keep Context in the right sidebar. Put Workers and Subagents beside the other activity tabs in the bottom drawer.
- Remember the user-resized sidebar width across sessions and restarts.
- The historical width defaults are 36 columns, 40 from 160 terminal columns,
  and 44 from 220 columns; resizing stays within 30–72 columns where space allows.
- Preserve mouse resizing and keyboard width commands. Narrow terminals use an overlay.
- Keep real tasks, changed files, LSP and workspace details reachable in Context.
- Retain V2 session/protocol boundaries beneath these Redcode interactions.

See `docs/migration-parity.md` for verified paths and outstanding behavior. This
reference does not claim that the migration already reproduces every screen.
