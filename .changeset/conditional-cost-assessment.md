---
"@reddb-io/redcode": minor
---

Calculate conditional model-catalog estimates using observed request facts, ordered context overrides, nested multipliers, separate reasoning rates and explicit measurement units. Preserve cache write TTLs and refuse estimates when required price facts or usage meters are missing. Explicit local token-price overrides retain precedence and provider-reported USD, including zero, remains authoritative.

Persist reported, estimated or unknown cost provenance on new step settlements and auxiliary usage records. Preserve old numeric totals and leave historical records unclassified. Session statistics now expose cost coverage, and the existing budget view includes unknown-cost steps and auxiliary usage across descendants without counting compaction summaries twice.
