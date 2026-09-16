---
"@reddb-io/redcode": minor
---

Sign in to MCP servers without leaving the TUI. `/mcp` (palette: "MCP servers") lists each server with its status, tool count and OAuth state, and offers Authenticate, Log out, Reconnect and Enable/Disable. Signing in opens the browser once and reconnects the server in the running session; when no browser can open, or the TUI is attached to a server on another host, copy the URL and paste the redirected address back. A server that needs authentication, including after its token expires mid-session, raises one notification with an Authenticate button, and its sidebar entry is clickable. The server adds `GET /mcp/info`, `POST /mcp/:name/auth/wait` and `POST /mcp/:name/auth/cancel`.
