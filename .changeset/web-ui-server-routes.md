---
"@reddb-io/redcode": patch
---

The background service answers its own routes again when it serves the web app. Legacy RPC (`POST /rpc`, used by `redcode-rpc-sidecar`) no longer fails with HTTP 405, and a Design review no longer opens blank: `/design/session/...` pages reach the server instead of receiving the web app's index page, whose `/_assets/*` scripts the Design app cannot serve.
