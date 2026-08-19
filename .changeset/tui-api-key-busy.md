---
"opencode": patch
---

TUI: the `/connect` API key dialog now shows a busy spinner while the credential is saved and the instance re-bootstraps, and surfaces save failures as a toast. Previously the dialog looked frozen for the duration of the reload (tens of seconds when plugins or provider packages are reinstalled) and every extra `enter` re-submitted the key.
