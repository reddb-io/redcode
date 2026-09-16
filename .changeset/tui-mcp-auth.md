---
"@reddb-io/redcode": minor
---

Sign in to MCP servers without leaving the TUI. `/mcp` (palette: "MCP servers") lists each server with its status, tool count and OAuth state, and offers Authenticate, Log out, Reconnect and Enable/Disable. Signing in opens the browser once and reconnects the server in the running session; when no browser can open, or the TUI is attached to a server on another host, copy the URL and paste the redirected address back. A server that needs authentication, including after its token expires mid-session, raises one notification with an Authenticate button, and its sidebar entry is clickable. The server adds `GET /mcp/info`, `POST /mcp/:name/auth/wait` and `POST /mcp/:name/auth/cancel`. Pasted codes can carry the attempt's `oauthState`, and `mcp.auth.cancel` takes it too, so a late cancel from a replaced dialog cannot end a newer attempt. A 401 on a live connection now asks for sign-in only when the token could not be refreshed. Servers with `oauth: false` report `failed` instead.

Older TUIs attached to this server no longer receive the server-side "Run: redcode mcp auth" toast when a server needs authentication. They still show the status, and `redcode mcp auth <name>` still works.
