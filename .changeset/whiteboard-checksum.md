---
"@reddb-io/redcode": patch
---

Verify the whiteboard bundle against the release SHA256SUMS before unpacking it

The Design whiteboard tarball fetched from GitHub Releases is now checked
against the `SHA256SUMS` published with the same release: a missing entry or
a mismatched digest refuses to unpack and surfaces as a clear `unavailable`
error instead of installing whatever came down the wire. Both downloads carry
a 60 s timeout, a failing `tar` reports its exit code and stderr, and an
archive without `whiteboard.js` is rejected before it can be renamed into the
cached release directory.
