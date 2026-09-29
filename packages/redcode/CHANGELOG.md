# @reddb-io/redcode

## 0.60.0

### Minor Changes

- Add an MCPs tab to the session drawer with server status, tool discovery, and runtime controls to add, connect, disconnect, and unload servers.

### Patch Changes

- Honor RedRouter and 9Router model parameters for context and output limits, modalities, tool support, and advertised reasoning levels. Keep native provider parameters on their existing provider adapters and avoid sending tools to models whose catalog forbids them.
- Add Alt+1 through Alt+0 to select open session tabs directly, and keep Ctrl+Tab and Ctrl+Shift+Tab for cycling tabs without Zellij shortcut conflicts.
- Restore the separate System Two transformations model in setup and summary compaction, allow a configurable compaction summary output limit, and simplify S1/S2 setup with a shortcut for saved roles and provider-first model selection. Reconnect 9Router with endpoint and model discovery, and show Redcode branding on OAuth callback pages.

  Restore readable S1/S2 model names and route labels in the prompt, model picker, setup, and intelligence status. Preserve router catalog owners, aliases, and exact model IDs while enriching missing names from the bundled models.dev catalog.

## 0.59.5

### Patch Changes

- Preserve conversation history when a V2 compaction checkpoint is incomplete or fails to reduce context. Accept a complete checkpoint when the provider stops at its output limit. Carry bounded user and file anchors across summaries and pause automatic compaction after repeated ineffective checkpoints, with the pause stored in session metadata.
- Restore Redcode project hooks on the V2 runtime: configuration, trust fingerprints, explicit Claude hook import and the /hooks dialog. Reconnect prompt admission, tool execution, permissions, compaction, message and session lifecycle, and subagent hooks while preserving trust invalidation and bounded command output.
- Use the saved RedRouter endpoint for both System One and System Two. Complete System One model setup in the CLI and show the effective S1/S2 selections and their origins in the TUI.
- Restore the Redcode experience on the V2 engine: open real blank sessions at startup and through /new and /clear, restore the Redcode default theme and stable built-in agent colors, and keep Context, Workers and Subagents visible in the session workspace.

  Restore the persisted task sidebar through the V2 session API and preserve the existing Goal slash commands.

  Restore session modified files and language-server status in the sidebar, and reconnect /monitors to authenticated V2 list, inspect and cancellation APIs with session isolation and bounded evidence.

  Keep the modified-files sidebar cumulative across the full session instead of displaying only the latest interaction.

- Restore Redcode's sidebar widths from v0.57.0 and keyboard resizing on the V2 TUI. Keep Context in the right sidebar and move Workers and Subagents into the bottom activity drawer, sharing worker status with the full management page.

  Preserve the empty Context summary and separate project/worktree/branch lines, with text fitted to the sidebar width. Keep legacy sidebar keybinding names; leader+w opens the activity drawer and leader+Shift+w closes a V2 session tab.

  Restore the Todo title, bracketed task markers and status colors, the original section order, and collapse controls only for lists with more than two entries.

  Restore subagent model details and open/steer/kill controls using V2 prompt admission and interruption, including confirmation before stopping a child.

  Restore /context, /subagents, /thinking and /timestamps. Keep /thinking as the display toggle; model effort remains available through /variants and /effort.

  Preserve the historical red scrollbar and informational colors in both light and dark Redcode themes.

  Restore `/pending` over the V2 durable inbox, including queued and steering prompts, timestamps, attachment counts, send-now, discard, discard-all and an explicit empty state. Keep the pending management panel available in direct mode even when the queue is empty.

  Restore `/budget` and Goal cost/token budgets on the V2 runtime. Enforce session, parent-session and Goal limits before each model step, count descendant usage, and show configured limits in the Context sidebar.

  Restore the RedRouter connection endpoint prompt and persist the selected API URL with its credential while continuing to read pre-migration connection metadata.

  Show RedRouter as the first connection option in the Popular group.

  Restore the Redcode session epilogue and clearly show whether Redskilled is on or off in the Workers drawer.

  Remove remaining upstream product branding from Redcode's visible TUI and CLI messages, links, window titles and crash reporting.

- Consolidate validation and releases into one independent Redcode workflow. Keep Linux and Windows product contracts and service startup checks, with Changesets SemVer versioning, npm publication and GitHub releases from main.
- Show a compact Redskilled status beside Server in the TUI's bottom bar. Keep the Workers drawer concise and make connection details available on demand.

## 0.59.4

### Patch Changes

- Wait for plugin activation before listing agents from a newly started server, so `agent list` and `debug agents` include Redcode's built-in and configured agents on their first request.

## 0.59.3

### Patch Changes

- Restore Redcode's S1/S2 setup and evaluation history, Design conversation commands,
  and voice dictation into the composer after the OpenCode V2 migration. Preserve
  Redcode branding and the `/mcp` shortcut. Remove inherited upstream automations
  from the active CI/CD workflow set.
