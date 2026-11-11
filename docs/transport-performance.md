# Transport and location startup measurements

## Desktop idle-memory incident, 2026-11-11

The affected Linux desktop's own log identifies packaged Redcode 0.87.19. Its user journal records `systemd-oomd` killing four processes in the application's scope after 5h 1m, with a 16G scope memory peak and 424.6M swap peak. A separate GNOME launch scope reported 2G. These are scope peaks, not individual process measurements or proof of the server's heap size. The processes had already exited, so no heap snapshot was available. Embedded development pages were present in the surviving logs; a warning about eleven download listeners is a lead, not proof of leaked listeners, because pages share an Electron session and unregister on disposal.

The embedded browser enables the CDP Runtime domain for diagnostics. Its 500-entry text history did not release Chromium's original console objects. An isolated Chromium experiment logged 80 objects containing arrays of 100,000 elements, then forced garbage collection:

| Inspector cleanup               | Heap before |   Heap after | Retained growth |
| ------------------------------- | ----------: | -----------: | --------------: |
| None                            |   491,944 B | 32,495,368 B |    32,003,424 B |
| `Runtime.releaseObject` only    |   491,944 B | 32,495,368 B |    32,003,424 B |
| `Runtime.discardConsoleEntries` |   491,944 B |    492,000 B |            56 B |

Diagnostics now discard the inspector's console storage after copying bounded console/exception text, coalescing concurrent requests separately for each frame target. The production-code regression in `packages/app/e2e/regression/desktop-browser.spec.ts` uses Chromium's real CDP transport. Before the fix its console case retained 32,003,448 B; it now verifies that console and exception text remain readable while their large object graphs can be collected. The 4 MiB assertion is test tolerance, not an application RAM limit.

Desktop logs now sample current process RSS, swap where available, CPU, main-process JS heap, and WebContents IDs/types once per minute. Samples use the existing rotating log files, retain no in-memory history and record no page URLs or process command lines. Linux RSS is read asynchronously from procfs because Electron's working-set field is unavailable there; the memory panel uses the same sampler. No RAM warning threshold, forced tab reload or automatic application restart was added.

This reproduction establishes one retention mechanism; it does not attribute the full 16G incident to that mechanism or replace a multi-hour packaged-desktop soak with the same embedded pages. Hidden-page throttling and the remaining browser/network lifetimes still need that measurement.

Run the regression from `packages/app` with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:1 bunx playwright test e2e/regression/desktop-browser.spec.ts --workers=1`. It uses isolated pages and does not contact the installed Redcode server.

These diagnostics use a separate loopback Redcode server with an in-memory database, isolated temporary configuration, no model downloads, and filesystem watching disabled. They do not connect to the installed service. Run them serially from `packages/client` with Bun:

```sh
bun run script/bench-location-sync.ts
bun run script/bench-response-compression.ts
bun run script/bench-http2-proxy.ts
```

The scripts report each sample rather than applying machine-dependent pass thresholds. The first sample warms the server and connection; the remaining five are reported. The measurements below were taken on Windows with Bun 1.4.4. They use the current source runtime, not packaged Electron or a production frontend build. They are diagnostic evidence, not a user-facing latency benchmark.

## Location startup

`bench-location-sync.ts` exercises the real client data layer, the app's four-slot request queue and an isolated server. It adds an 80 ms delay to each request before sending it; this approximates a uniform round-trip cost but does not simulate real WAN, TLS, packet loss, radio conditions or the browser. It measures response-header arrival for `/api/model`, not model selection paint.

| Measurement                                    |    Before |     After |
| ---------------------------------------------- | --------: | --------: |
| Model response headers, median, 80 ms injected | 257.02 ms | 170.84 ms |
| Full location sync, median, 80 ms injected     | 338.14 ms | 336.85 ms |
| Requests                                       |        13 |        13 |

Before samples in milliseconds: full sync `[344.17, 338.14, 337.21, 344.48, 335.70]`; model headers `[259.42, 257.02, 254.49, 262.47, 253.45]`. After: full sync `[346.27, 342.74, 336.85, 332.88, 332.48]`; model headers `[170.36, 179.48, 173.73, 170.84, 169.94]`. Samples were collected sequentially against independently booted in-memory servers; fixture initialization is excluded.

When an explicit directory is supplied, scoped reads now start alongside location resolution. The implicit default still resolves first, because the server can return a different canonical directory. The full sync remains four waves at the present queue limit; the improvement is earlier model response availability, not fewer requests or a faster full sync. End-to-end UI impact remains unmeasured.

## Response compression

`bench-response-compression.ts` requests the actual server's `/openapi.json`, counts raw response bytes using Node HTTP, validates decoding, and measures the complete local response. It is a highly repetitive API specification, not a representative model catalog, conversation or user upload.

| Encoding | Wire bytes | Decoded bytes | Median loopback response |
| -------- | ---------: | ------------: | -----------------------: |
| identity |    641,657 |       641,657 |                  2.59 ms |
| gzip     |     54,654 |       641,657 |                  7.29 ms |
| br       |     53,545 |       641,657 |                  5.78 ms |

The normal server already negotiates Brotli/gzip for eligible responses. SSE explicitly uses `no-transform` to preserve incremental delivery. The loopback measurement favors a fast network and includes server compression, transport and response receipt; it is not an isolated CPU benchmark. Request-body compression is not enabled by these changes.

## HTTP/2 experiment

`bench-http2-proxy.ts` sends 12 small reads through isolated HTTP/1.1 and cleartext HTTP/2 loopback proxies backed by the real Redcode server. Each proxy delays each request by 80 ms before forwarding. HTTP/1.1 uses a keep-alive pool with the stated socket cap; HTTP/2 uses one connection with the stated stream concurrency. The test does not exercise TLS negotiation, browsers, a real remote tunnel, packet loss, SSE, WebSockets, mobile radios or production traffic.

| Scenario                |    Median |
| ----------------------- | --------: |
| HTTP/1.1, 4 concurrent  | 252.77 ms |
| HTTP/2, 4 concurrent    | 253.33 ms |
| HTTP/1.1, 6 concurrent  | 167.93 ms |
| HTTP/1.1, 12 concurrent |  86.98 ms |
| HTTP/2, 12 concurrent   |  85.28 ms |

These controls show that increasing parallelism, rather than the protocol name alone, explains most of the observed difference in this artificial delay model. They do not establish that a 12-connection HTTP/1.1 browser configuration is available, appropriate or safe, nor that a server can handle 12 costly operations without contention. Do not change the app's concurrency limits or server listener based on this experiment alone. A production-build browser/Electron benchmark against local and deployed remote servers, with TLS, streaming, PTY and slow-operation contention, is needed before changing HTTP/2 or queue limits.

## Grouped catalog bootstrap and on-demand MCP resources

The location bootstrap now requests models, providers and integrations together. MCP resource inventory is requested when a client reads it or explicitly synchronizes it. Servers without the grouped route fall back to the three existing reads; errors other than an unsupported endpoint remain visible. Model/provider invalidations that arrive while the grouped request is in flight still trigger fresh individual reads.

The same loopback server benchmark was repeated sequentially before and after this change. The prior client already contained the parallel location-resolution optimization described above. These are five warm samples with 80 ms injected per request, not measurements from a real WAN:

| Measurement                            | Before grouping | After grouping |
| -------------------------------------- | --------------: | -------------: |
| Requests                               |              13 |             10 |
| Full location sync, median             |       344.49 ms |      269.05 ms |
| Model/catalog response headers, median |       185.30 ms |      179.00 ms |

Before full-sync samples: `[381.69, 343.85, 344.49, 350.30, 343.43]`; after: `[312.15, 262.95, 269.05, 261.95, 271.22]`. Before model headers: `[216.62, 181.19, 185.30, 190.35, 182.24]`; after grouped response headers: `[223.86, 179.00, 178.28, 178.20, 187.26]`. The grouped response contains three catalogs, so its header timing is not the time an individual row was painted.

## Production-renderer UI observations

The production web bundle was measured in Chromium on Windows with Playwright's deterministic routed fixtures, one worker, three repetitions per scenario. These are UI observations with mocked APIs, not packaged Electron, an actual remote server, or a controlled network-latency test. Each navigation measure begins at the interaction; the selector measurement starts after a new session and its catalog are ready, so it measures opening the already-loaded selector rather than startup catalog loading.

| First correct observation, median        |   Before |    After |
| ---------------------------------------- | -------: | -------: |
| Open a cold existing session from Home   | 783.8 ms | 834.4 ms |
| Open a new session from Home             | 402.1 ms | 430.1 ms |
| Open the model selector in a new session |  42.0 ms |  41.5 ms |

With only three samples per condition and no simulated remote latency in this UI fixture, these observations do not establish a user-visible improvement or regression. The first-correct observation is not a compositor presentation time. Original benchmark records and all raw observation samples are preserved in `docs/evaluations/location-bootstrap-ui-before.jsonl` and `docs/evaluations/location-bootstrap-ui-after.jsonl`. A production Electron and real remote-server measurement is still required.

## Packaged Windows desktop

The current source was packaged as a Windows x64 Electron application and paired with a freshly compiled Redcode server of the same version. The benchmark used a separate temporary home, database, project and desktop profile, with a temporary protocol name to avoid changing the installed app's `redcode://` handler. It did not use the user's servers, sessions or credentials. The production renderer and server source include the grouped bootstrap changes, but this is not the published release. HTTPS was disabled for these experiments; no provider network calls were made.

`packages/desktop/scripts/bench-startup.ts` ran serially on Windows, once for warm-up and five measured runs per case. The onboarding was completed beforehand. The warm case reused an already running local service; the cold case started the service for each launch. The elapsed times start at desktop process spawn. `shellVisible` observes the navigation rail in the renderer; it is not a display-presentation timestamp. Screen timing is sampled separately by the existing harness.

| Median | Local service already running | Desktop starts local service |
| --- | ---: | ---: |
| Service ready | 454 ms | 1,217 ms |
| Navigation rail visible | 767 ms | 1,352 ms |
| Screen content settled | 873 ms | 1,405 ms |

These cases were measured sequentially and are not an alternating A/B experiment. The startup report retains per-sample renderer, process and timing data in `docs/evaluations/desktop-startup-warm.json` and `docs/evaluations/desktop-startup-cold.json`. Their process working-set figures do not include the separately running service and are not a measure of unique memory.

An exploratory Playwright session then drove the packaged application against the real isolated local server, with a single explicitly configured fictional OpenAI-compatible provider and model. For each condition, one warm-up and five samples reloaded the desktop renderer, clicked New session on an isolated project, waited for the editable draft and the chosen model, then opened the picker and waited for that model to appear. Chrome DevTools network emulation was set to either zero or 80 ms latency before reload. This affects the browser network stack; it is an artificial local proxy for latency, not a real remote network, TLS, packet loss or an existing session with history. It is not an A/B comparison of the previous implementation.

| Median after user action | Loopback, no added latency | 80 ms network emulation |
| --- | ---: | ---: |
| Draft editor visible | 177.1 ms | 309.0 ms |
| Chosen model button visible | 245.9 ms | 1,066.7 ms |
| Picker opens with model, after model is ready | 84.6 ms | 82.7 ms |

The latter measures an already-loaded picker; it does not include provider discovery. The five emulated-latency model samples varied from 632.5 to 1,097.7 ms. Request paths recorded from the New session click until the picker was ready, including overlapping background activity, and every raw observation are in `docs/evaluations/desktop-journey-network-emulation.jsonl`. These counts are not a complete page-load waterfall. Existing restored draft tabs and background work can influence them; no conclusion about the grouped endpoint's isolated improvement can be drawn from these numbers.

The exploratory request traces show individual `/api/provider`, `/api/model` and `/api/integration` reads during the interaction. The provider and integration catalog hooks can initiate separate reads before `location.sync` groups them, so the grouped path is not guaranteed to cover this journey. The next investigation should correlate requests by canonical location, initiation point and invalidation, then route these consumers through one shared catalog bootstrap while preserving independent refresh and old-server fallback. Re-measure an alternating before/after packaged build with the same fixture before claiming an improvement. The real LAN addresses supplied for the other PC did not accept connections on the common ports tested; a listening remote Redcode URL and its appropriate authentication are still needed for a genuine remote test.

## Shared catalog consumers: packaged follow-up

The provider and integration hooks now join the same location catalog bootstrap as the location loader. Individual refreshes still use their own invalidation keys and old servers fall back to their existing routes. The desktop was rebuilt and the exploratory journey above was repeated with the same isolated server, project and five-sample method. The new build also includes design system v2026.11.6; runs were sequential, not alternated, and the persistent profile had accumulated additional draft tabs. Treat this as a directional observation, not a controlled attribution to one change.

| Median | Before, loopback | After, loopback | Before, 80 ms emulated | After, 80 ms emulated |
| --- | ---: | ---: | ---: | ---: |
| Draft editor visible | 177.1 ms | 204.5 ms | 309.0 ms | 313.5 ms |
| Chosen model button visible | 245.9 ms | 254.1 ms | 1,066.7 ms | 614.8 ms |
| Open picker after model ready | 84.6 ms | 90.8 ms | 82.7 ms | 85.4 ms |

In the five measured 80 ms runs, the request window between clicking New session and the picker becoming ready included three individual catalog calls before and a single grouped bootstrap after; total observed requests in that window fell from 24 to 22. The window excludes requests started before the click and includes concurrent background work, so it is not the complete startup waterfall. Raw after samples are in `docs/evaluations/desktop-journey-shared-catalog-after.jsonl`; before samples are linked above. A real remote-server benchmark and an alternating comparison with an identical restored profile remain necessary.

After adding the opt-in, lazily loaded lineage graph, the production web renderer's cold-session-from-Home benchmark passed three times with first-correct observations of 707.6, 737.1 and 761.3 ms. The earlier grouped-bootstrap production-renderer baseline was 899.9, 781.2 and 834.4 ms. These runs are sequential, use mocked APIs and different intervening application changes, and do not establish a causal speedup. Raw follow-up records are in `docs/evaluations/lineage-session-entry-after.jsonl`.
