---
"@reddb-io/redcode": patch
---

File search on Linux no longer runs `ldd --version` to choose its native library, which could freeze redcode at startup under Bun 1.4.
