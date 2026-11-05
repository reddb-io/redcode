# OpenCode follow-up: compaction buffer

OpenCode 2.2.5 accepts a percentage for `compaction.buffer`. Redcode now accepts the same format alongside existing non-negative token counts. For example:

```json
{ "compaction": { "buffer": "20%" } }
```

This reserves 20% of the selected model's input limit (or its context window when no input limit is known), so automatic compaction starts when the estimated prompt reaches the remaining 80%. Decimal percentages such as `12.5%` are accepted from 1% up to, but not including, 100%. Each model's limit is evaluated independently. An unknown window continues to use the existing fallback behavior; an unset buffer and existing numeric configurations retain their previous behavior.

The comparison is based on the [OpenCode 2.2.5 release](https://github.com/anomalyco/opencode/releases/tag/v2.2.5) and its [configuration schema](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/schema/src/config/compaction.ts). This is a compatibility feature, not evidence of a measured performance improvement.
