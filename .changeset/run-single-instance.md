---
"@reddb-io/redcode": patch
---

`redcode run` boots one instance, in the directory it was started in (or `--dir`). It used to derive the session's directory from `PWD` while the instance it booted came from the process's working directory; when a spawner set the working directory but left another shell's `PWD` in the environment (CI runners, process managers, editors), the in-process server loaded a second instance for the session and the turn's tools ran there. A relative `--dir` now also resolves against the working directory rather than `PWD`.
