---
"@reddb-io/redcode": patch
---

The design app now ships in the same release as Redcode: every archive carries `redcode-design` beside `redcode`, and npm installs the matching `@reddb-io/redcode-design-<target>` package with it. Redcode no longer downloads the design app from a separate `design-v*` release, and the `design.app.version` setting is ignored. macOS archives are now `tar.gz`.
