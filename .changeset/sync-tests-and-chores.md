---
"@reddb-io/redcode": patch
"@reddb-io/redcode-core": patch
---

Ported from upstream: console device URLs, GitHub OIDC subjects, and test hygiene

Console device-auth URLs resolve correctly; the GitHub app accepts immutable OIDC subjects; development runs on native runtime conditions instead of `--conditions=browser`; a test guards that every patched dependency is at the version its patch targets (and drops a patch for a version nothing uses); the core test preload disables npm audits.
