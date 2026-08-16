---
"opencode": patch
---

Show the provider, model and request URL on provider transport failures.

A failing provider request used to print only the response body, e.g. `404 Page not found`, which cannot be told apart from a wrong API key, a wrong model id, or a wrong host. The request URL was already recorded on the durable message record but never displayed. It is now shown on both the CLI (`redcode run`, interactive and streaming) and the TUI message panel:

```
404 Page not found
  provider minimax/MiniMax-M3
  request  https://api.minimax.chat/v1/messages
  status   404
```

The resolved provider and model are now recorded on the error itself, so `session.error` events and `--format json` carry them too. Request URLs are redacted before display: userinfo, fragments, and all query values outside a small allowlist are withheld, so an API key embedded in a URL cannot leak. Response headers are never displayed.
