---
"opencode": patch
---

Reduce CI flake from slow `bun run` startup in subprocess tests and an `active`-marker race in the flock stress test.

- `packages/opencode/test/lib/cli-process.ts` — prefer the prebuilt `redcode` binary (`dist/redcode-linux-x64/bin/redcode`) over `bun run --conditions=browser src/index.ts` when the binary is present. Cuts subprocess startup from ~20s to ~5s and keeps the run-process tests comfortably under their 30s `timeoutMs` even when many tests run concurrently.
- `packages/core/test/util/effect-flock.test.ts` — drop the `active` marker from the mutual-exclusion stress test. The marker sits outside the lock directory, so its `wx` create races between a holder's `fs.rm(active)` and the next holder's `fs.writeFile(active)`; on Windows the race window is wide enough to produce intermittent non-zero exits even though the flock itself is correct. The serialized work + `done.log` line count are sufficient to prove mutual exclusion.
