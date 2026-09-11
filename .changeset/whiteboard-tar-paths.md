---
"@reddb-io/redcode": patch
---

Unpack the whiteboard bundle on Windows when GNU tar is first on PATH

GNU tar reads a drive letter such as `C:` as a remote host, so extracting the
bundle by absolute path failed with exit code 2 on machines where Git's tar
shadows the system one. The installer now runs tar inside the release
directory with relative names only.
