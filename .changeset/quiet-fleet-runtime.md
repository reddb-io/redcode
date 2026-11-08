---
"@reddb-io/redcode": patch
---

Preserve protocol-generated `anthropic-beta` values on GitHub Copilot requests instead of replacing them with a single legacy beta.

Keep Markdown agents whose descriptions begin with an unquoted bracketed tag while preserving valid YAML arrays in the same frontmatter.

Keep the TUI usable when a plugin dialog crashes, and report unsupported clipboard reads instead of silently ignoring paste attempts.

Sanitize generated session titles before sending terminal control sequences so multiline titles cannot crash the TUI.

Avoid claiming that models are available after connecting a provider that returned an empty model catalog.

Accept successful MCP tool results even when a server omits or violates its declared output schema, avoiding false failures after side effects have already completed.

Honor each MCP server's configured startup timeout when a model waits for its tools, retaining the short two-second grace only for servers without an explicit budget.

Preserve DNS and unreachable-network codes from HTTP and WebSocket providers, report the affected host clearly, and keep retrying temporary connectivity loss on its own bounded recovery budget.

Keep Console organization policies active when auxiliary instruction or skill catalogs fail, retaining the last valid lists independently for the current connection.

Report shell timeout and exit status precisely, keep truncated output on complete UTF-8 and line boundaries, and let zsh pass unmatched globs through instead of aborting the entire command line.

Fetch Console instructions and versioned skills concurrently, keep auxiliary skill files in memory under safe `skill://` URIs for agents, and let Desktop and Web recognize virtual skill documents without writing them into the project.

Give every Code Mode tool call a stable run-scoped idempotency key and expose forward-compatible idempotent and durable tool wrappers, preserving start/wait behavior on the legacy engine while the resumable VM is adopted.

Match web fetch permissions against the URL exactly as written while removing fragments that HTTP never sends, preserving Vault references and avoiding spurious permission prompts.

Require external-directory approval before an agent moves a session outside its project, while resolving relative destinations from the target session and allowing registered project worktrees without another prompt.

Show compact calendar dates for sessions older than a week in the command palette and workspace settings, with the exact timestamp available on hover.

Give TUI messages, queued prompts, revert summaries and tool blocks consistent right-side breathing room while recalculating path, shell and diff widths to prevent clipping.

Resolve Local and new-worktree sessions from the canonical checkout, showing the main branch even when New session was opened from another worktree.

Name unknown MCP actions in permission prompts and show the hook message and complete tool input before the user authorizes the call.

Keep session export filenames within filesystem limits when a generated title is unusually long.

Bring readers near the end of a Desktop or Web transcript down to the prompt they just submitted, while preserving the position of readers who are far enough back to see Jump to latest.

Reduce server, CLI and TUI resource use by releasing JSON Schema callers, truncating oversized search matches before retention, bounding agent inventories, skipping dependency trees during agent discovery, avoiding idle Location boots, stepping tab activity at 20 fps, loading only a bounded Home session index with scoped reads for older projects, and keeping routine config conversions and child-process launches out of default server logs. Trace each session drain independently, correlate tool calls to their session, and record provider, model, token usage, routed cost, first-output latency and retry attempt without emitting a span for every streamed model event. Let OpenCode Console workspaces advertise event watches that add watch, unwatch and watches tools, share one authenticated WebSocket per workspace with long-poll fallback, wake owning sessions through idempotent steers, and stop unattended agent loops after five consecutive watch wakes. Store projected attachments once by content hash, keep legacy and TUI reads compatible, and let Desktop/Web load referenced media on demand through a cacheable authenticated endpoint with bounded retries while keeping exports, clipboard files and restored drafts self-contained. Supervise Markdown workers with coalesced lanes, bounded caches, hang detection and crash recovery; explicitly dispose typewriter and shimmer timers; and honor reduced-motion preferences without leaving animation work behind. Preserve partial custom-model limits and inline variants during legacy migration, migrate legacy Markdown agents automatically, import legacy credentials during a fresh database bootstrap without letting malformed auth files brick startup, log invalid agent and command frontmatter with actionable diagnostics, exclude commentary from generated session titles, cap Console and MCP startup waits, expose Git's install error for failed plugins, and save TUI exports in the working directory. Keep a larger text-only composer history without pinning old attachments, reject nonexistent file mentions in comments, make slash/context menus reversible, preserve literal `$0` and `$ARGUMENTS` text in custom-command input, and expose a bounded `/reload` lifecycle for agents, commands, skills, MCP servers and plugins. Synchronize remote data only after the event stream handshake, fence stale endpoint resolutions, prioritize navigation and writes in the HTTP queue, dispose requests with their transport, recover optimistic prompts whose admission echo was missed, show prompts immediately while their agent/model catalog is still loading, serialize queue steer/remove actions with edits, reorders and undo, and bound new-session worktree, MCP and session phases so stalled starts roll back cleanly while late session creation is removed automatically. Let the TUI open exact child-session IDs, return to the focused MCP server after OAuth, honor keypad navigation, favorite models before connecting a provider, and prefer the terminal's reported theme; localize the Desktop context menu and keep partial review diffs collapsed to available hunks. Reject cross-site API requests unless their origin is trusted and serve repository files with inert download headers. Reconcile pending prompts from projected history after missed remote events, preserve MCP prompts across transient refresh failures, ignore IME-owned composer keys, wait for skills to activate, bypass proxies for loopback traffic, make Windows service writes and Store PowerShell launches resilient, and report resources that block shutdown.

Discover workspace MCP event types through Console, let agents watch a typed server event with its arguments, and always deliver relayed MCP payloads as fenced, non-user information before waking the owning session.

Give touch devices a dedicated composer dock with explicit Send, Queue, Steer and Stop actions, keeping voice, permission and context controls available while software-keyboard Return inserts a newline.

Render leading Markdown frontmatter as a compact, expandable properties list in Desktop and Web artifact previews, while preserving ambiguous YAML and the original file used by Source, Copy and Download.
