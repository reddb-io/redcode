---
"@reddb-io/redcode": patch
---

The stop-loss spend clock excludes time spent executing tools, counting overlapping tools once, so long builds and tests do not cause a time-spend warning on their own. The wait budget for an external job still uses wall time. Releases now require the vault coverage check and the smoke against the shipped binary to pass, and CI runs the restored harness, provider and Design regression suites.
