---
"@reddb-io/redcode": patch
---

Qualify CLI statistics with reported, estimated, unknown and legacy cost coverage. Incomplete model totals show a known subtotal, unresolved zero contributions show unknown instead of free usage, and older records retain their values with an explicit provenance notice. The shareable default output continues to omit monetary details.

Preserve cost assessment metadata when the shared Solid client projects successful and failed step events, so clients receive the same provenance before and after reloading session history.
