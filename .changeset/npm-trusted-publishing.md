---
"@reddb-io/redcode": patch
---

Publish npm packages through npm trusted publishing (OIDC) instead of a 2FA-bypass token, and publish the GitHub Release once its binaries are uploaded and smoke-tested, so an npm failure no longer holds back mise installs. When npm stages a version for maintainer approval instead of publishing it, the release job now names the staged packages and the approval steps instead of reporting registry lag.
