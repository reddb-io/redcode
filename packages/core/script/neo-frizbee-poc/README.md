# neo_frizbee candidate probe

This isolated probe checks which FFF top-50 paths are candidates when matching the same ripgrep inventory with `neo_frizbee` 0.11.0 (MIT). It verifies the inventory hash and does not reproduce FFF ranking, watchers, git boosts, or the full RedCode contract. The input must be a local FFF ranking report created with `--include-common-paths`; that input can contain sensitive paths. The output contains counts and hashes only.

```powershell
cargo run --locked --release -- REPOSITORY FFF_DIAGNOSTIC_JSON OUTPUT_JSON
```

The RedCode adapter's separately gated `neo-frizbee-experiment` is documented in the FS-001 ledger. Neither experiment is an approved replacement.
