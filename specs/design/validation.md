# Design Studio validation

Verified locally on 2026-09-07 with Bun and Chromium.

- Core: 13 tests covering frozen React/Solid component builds, rendered audits/comparison, decoded GIF timing and movement, cancellation/retry, immutable approval packages, feedback identity, asset validation, plugin lifecycle and stdio MCP discovery.
- Browser: five real SessionV2 journeys for intake, HTML review with lost-response retry and approval, Solid interaction/restoration, SVG import and GIF download, and editable Excalidraw feedback. The GIF journey passed again after adapting the test HTTP handler.
- MCP: paginated discovery and canonical image-plugin registration passed a final focused run (two tests).
- App preview selection: two tests passed.
- HTTP API code generation: 61 tests passed, including binary response decoding. Regeneration was deterministic.
- Retained vendor helpers: 179 tests passed.
- Typechecks: schema, core, protocol, server, plugin, client, design, app, tui, redcode and httpapi-codegen passed.
- Database: migration/schema/registry consistency check passed without pending schema differences.

Browser fixtures exercise durable prompt admission without selecting a paid provider. The advisory runner consequently logs ModelNotSelectedError; no external model quality or paid image-generation result was evaluated. Local stdio MCP was exercised; remote authentication uses configured headers and does not implement a new OAuth consent flow.

## Production session benchmark

The existing V2 session-switch benchmark uses five samples per case with the review pane closed/open and cold/hot navigation. Both baseline and the final production-build run passed, with zero blank or wrong-destination samples. This measures session navigation with the existing review panel; Design-specific interaction is covered separately by the browser journeys above.

Median milliseconds:

| Pane / navigation | Baseline correct | After correct | Baseline stable | After stable |
| ----------------- | ---------------: | ------------: | --------------: | -----------: |
| closed / cold     |            137.1 |         205.3 |           190.5 |        280.1 |
| closed / hot      |             35.4 |          49.2 |            83.3 |        105.6 |
| open / cold       |            138.4 |         161.9 |           270.6 |        274.1 |
| open / hot        |            108.2 |         120.0 |           170.3 |        186.3 |

The first post-change run was slower than the baseline. These workstation measurements do not establish causality; unrelated workloads were also active. The production build initially exceeded the harness's 120-second startup allowance, so validation used a temporary 600-second allowance without changing the benchmark assertions. Chromium/teardown hooks also timed out under concurrent load; the affected checks passed when repeated with sufficient startup/cleanup time.

Baseline run: `2026-09-07T06-01-46-306Z-3082323`. Post-change run: `2026-09-07T07-05-51-307Z-3235324`.

A second post-change run reused the same production bundle, with no concurrent tests or typechecks from this task. It passed the same functional assertions, but latency remained above baseline:

| Pane / navigation | Repeat correct | Repeat stable |
| ----------------- | -------------: | ------------: |
| closed / cold     |          287.0 |         413.7 |
| closed / hot      |           55.5 |          94.9 |
| open / cold       |          366.0 |         460.4 |
| open / hot        |          122.8 |         240.1 |

Repeat run: `2026-09-07T07-13-57-058Z-3256149`. Performance remains an open finding: these runs do not establish whether the slowdown is caused by this change or workstation contention. No claim of performance parity is made.
