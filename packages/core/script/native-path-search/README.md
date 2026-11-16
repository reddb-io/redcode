# Filename index PoC

This Rust library owns filename/directory strings and fuzzy matching. The integrated TypeScript adapter keeps ripgrep discovery, ignore rules, lazy initialization, scoped disposal and ten-second asynchronous refresh policy. The selector prefers Rust when its library is available; cross-platform promotion and distribution validation remain incomplete.

The index has no watcher, Git status worker or content index. The asynchronous constructor copies the input and uses one short-lived Rust thread per snapshot; the ready handle is then published atomically by the TypeScript adapter. Queries run synchronously on the caller thread. Each handle has a single owner; calls must not overlap. Directory results, empty queries, pagination limits and UTF-8 crossings are exercised by the shared contract, benchmark and Rust tests. Ranking is supplied by `nucleo-matcher` and is not identical to fuzzysort or FFF.

Dependencies are locked in Cargo.lock. `nucleo-matcher` 0.3.1 uses MPL-2.0. The native package copies its complete license, adds a third-party notice with the upstream/source location and records both hashes in `manifest.json`; the dependency source is not modified. Build and release wiring includes native artifacts, but the external release matrix has not yet been validated.

From this directory, on Windows with Rust/MSVC available:

```powershell
cargo build --release --target-dir C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13/native-target
cargo test --release --target-dir C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13/native-target
bun run package-native.ts --target windows-x64 --out C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13/native-packages --cargo-target C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13/native-package-target
```

The experimental packager understands the same twelve package target names as the RedCode CLI build. Baseline variants share the Rust library for their OS/architecture. Linux musl uses dynamic CRT linkage because a static-musl target cannot emit a loadable `cdylib`; build and runtime smoke must run on a host with the corresponding linker and libc.
Windows packaging passes `/Brepro` to the MSVC linker so clean builds in different target directories have identical bytes.

Exercise the packaged ABI and all shared contract cases without installing the monorepo dependencies:

```powershell
bun run smoke-native.ts --lib C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13/native-packages/windows-x64/redcode_path_search.dll --fixture ../../test/fixture/filesystem-search-contract.json --out C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13/native-packages/windows-x64/contract-smoke.json
```

On a prepared RedCode runner, `validate-target.ts` runs packaging, exact-hash contract smoke, real-checkout ranking, create/rename/delete lifecycle, the five-process 50k comparison and its paired summary in sequence. It fails unless cold start is at most 5% slower, RSS improves by at least 25%, p50 is at most 5% or 1 ms slower, and CPU or p95 improves by at least 20%. `--soak-ms` adds the bounded stability probe; use `--skip-performance` only for a packaging/contract smoke:

Each full run needs a fresh output directory and at least five samples. `--allow-short` permits a shorter non-promotable smoke; its report and a contract-only report have `smokePassed: true` and `passed: false`.

Pass `--baseline fff` to compare performance and ranking against FFF instead of ripgrep/fuzzysort. FFF must be available on that host, and all sampled exact paths must become visible before ranking begins. A zero baseline CPU is reported as unavailable and cannot by itself satisfy the efficiency gate.

The ranking validator normally hashes paths. Pass `--include-common-paths` only for local diagnosis: it records the actual result paths for common queries in the output and can expose repository contents.

Add `--diagnose-typos` to generate insertion, substitution and transposition queries for sampled unique ASCII stems. These additional intents are subject to the same retention gates; the generated sample is a diagnostic and is not a substitute for independent user workloads.

For FFF diagnosis, `--fff-ready --fff-threads 1` waits for reported index readiness and limits search concurrency using the real adapter; the report marks this non-default configuration ineligible for promotion. `--include-answer-hashes` records per-query answer hashes without recording paths. `probe-fff-ranking-stability.ts` compares repeated searches within and across instances and optionally accepts `--settle-ms` and `--max-threads`.

`--diagnose-common-candidates` also reports how many baseline top-50 paths inside the ripgrep inventory occur anywhere in the Rust candidates, rejecting a potentially truncated candidate list. `analyze-fff-inventory.ts` diagnoses inventory differences from an opt-in `--include-common-paths` report after verifying its corpus hash. Both are diagnostics; neither replaces ranking gates.

The `ranking-basename-experiment` Cargo feature is an unpromoted ranking experiment, disabled by default. Build it with `cargo build --release --features ranking-basename-experiment` and run the complete ranking validator against the resulting library before drawing conclusions. `cargo run --release --example ranking_weights -- REPO FFF_REPORT RIPGREP_REPORT` explores weights on common-query diagnostic reports from the same corpus; it is a hypothesis generator, not an independent acceptance test.

The opt-in `typo-experiment` and `typo-always-experiment` features test bounded single-edit matching on ASCII names. They are not production-ready; the latter improved typo recall in one corpus but increased CPU in a short benchmark and failed other FFF comparisons. See the FS-001 ledger for scope and evidence.

`typo-mask-experiment` adds a necessary-character prefilter to the same experiment. It preserved observed outputs and reduced CPU against the prior experiment, but still failed the benchmark gates against ripgrep. It is disabled by default.

`typo-single-pass-experiment` fuses both scans. It preserved the measured outputs but did not improve CPU in the separate five-process trial and is rejected for promotion.

`typo-path-filter-experiment` also skips impossible ASCII paths before fuzzy scoring, while retaining the full scan for non-ASCII paths. It preserved measured outputs and reduced CPU versus the prior experiment in separate runs, but still failed the ripgrep performance gates. It is disabled by default.

`typo-signature-cache-experiment` reuses one-edit ASCII name checks among equivalent signatures. It improved p95 and memory in a repeated-name synthetic fixture, but failed the p50 gate and has not passed independent cross-platform validation. It is disabled by default.

`typo-score-shortcut-experiment` adds a score bound specific to locked nucleo-matcher 0.3.1. It passed the synthetic ripgrep performance gates, but FFF ranking gates and cross-platform validation remain open; it is disabled by default. Revalidate the score bound whenever the matcher or its configuration changes.

`neo-frizbee-experiment` tests the matching crate used by FFF 0.10.5. It is disabled by default and does not reproduce every FFF scoring feature. The candidate-coverage probe lives in `../neo-frizbee-poc`; an initial adapter benchmark showed higher CPU than ripgrep, and distribution of this optional MIT dependency has not been prepared.

`neo-parallel-experiment` uses short-lived search threads. Windows `GetProcessTimes` can undercount these; pass `--short-lived-threads` to the benchmark to prevent standard gate promotion and inspect the separately recorded process cycles. Cycles are not a direct substitute for CPU time. `examples/windows_thread_cpu.rs` demonstrates the accounting limitation.

`neo-pool-experiment` tests two persistent Rayon workers per index. The Windows accounting probe also observed undercounting for short tasks on persistent workers; use `--cpu-accounting-uncertain` and inspect cycles without converting them directly to CPU time. A six-cycle local check did not establish full lifecycle safety, and this option remains disabled by default.

`benchmark-file-search.ts --workload typo` measures a fixed synthetic typo workload and reports result counts and expected filename-family counts per query. It is diagnostic only: returned sets can differ, and the standard summarizer rejects these runs as promotion evidence.

```powershell
bun run validate-target.ts --target windows-x64 --out C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13 --cargo-target C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13/native-package-target-windows
```

From `C:/Users/filip/Work/redcode/packages/core`:

```powershell
bun run script/benchmark-file-search.ts --fixture-root C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13/interactive-comparison --out C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13/async-comparison --sizes 50000 --runs 5 --rounds 10 --query-delay-ms 50 --engines ripgrep,nucleo,nucleo-async --native-lib C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13/native-target/release/redcode_path_search_poc.dll
```

Omit `--fixture-root` to generate fixtures under the output directory. Use a separate output directory for each experiment. The benchmark asserts full expected corpus coverage and a top-50 result count for each timed query, and records first-result readiness, process/native memory, CPU and semantic differences. The comparison uses real production layers for the existing implementations and the experimental adapter for this library.
Summarize a completed directory with `script/summarize-file-search-benchmark.ts`; it preserves min/median/max, applies the predeclared performance gates and rejects mismatched run IDs, query counts or returned-result totals.

Ranking on a real repository uses the same full adapters and stores only hashes for generated paths and queries:

```powershell
bun run script/validate-file-search-ranking.ts --directory C:/Users/filip/Work/redcode --native-lib C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13/native-target/release/redcode_path_search_poc.dll --out C:/Users/filip/artifacts/redcode-fff-poc-2026-11-13/ranking-redcode.json
```

Production adoption still needs the remaining ARM64/macOS matrix, product acceptance of ranking, responsible license acceptance and longer platform lifecycle/soak tests. The module addresses backend filename search; it does not measure or change Electron renderer memory.
