---
"@reddb-io/redcode": minor
---

Share the CLI executable and runtime with the Design child process, removing the separate native Design package. Add server/worker release archives without Electron, and trim unused Desktop dependency exports and package-manager metadata. Install one compatible x64 baseline through npm instead of duplicate CPU variants, and declare Linux libc constraints to select glibc or musl.
