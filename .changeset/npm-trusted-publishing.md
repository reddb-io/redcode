---
"@reddb-io/redcode": patch
---

Publish npm packages through npm trusted publishing (OIDC) instead of a 2FA-bypass token, and publish the GitHub Release once its binaries are uploaded, smoke-tested, and handed to the npm job, so an npm failure no longer holds back mise installs. Reruns and `npm_only` runs for an already published tag unpack the npm packages from the checksum-verified release assets instead of rebuilding them. When npm stages a version for maintainer approval instead of publishing it, the release job now names the staged packages and the approval steps instead of reporting registry lag.
