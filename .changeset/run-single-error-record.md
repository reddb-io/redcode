---
"opencode": patch
---

Report a rejected `opencode run` prompt exactly once. The request's own error and the `session.error` event the server publishes for it are the same failure on two channels, so the run could print it twice — or emit two `error` records on `--format json` stdout — depending on whether the event subscription attached before the server published. The first reporter now wins and the other stays silent.
