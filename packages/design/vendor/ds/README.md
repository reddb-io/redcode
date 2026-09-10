# RedDB Design System distribution

Vendored byte-for-byte from reddb-io/design-system v2026.08.5, bundle.tar.gz.
Release: https://github.com/reddb-io/design-system/releases/tag/v2026.08.5
Bundle SHA-256: f2d29e20cb7decbcd2d7cc045100d6429fb5f9c4acbf06ce9c330e4aa6003a30

These compiled CSS files and the unchanged favicon are consumed by the shared Design review. The release ships Svelte Kit source, not a compiled browser JavaScript component bundle; the native review retains its current DOM behavior.

Run `bun script/brand.ts` from packages/design after updating these pinned files. It generates browser-safe string exports, mapping root selectors to the review shadow host without changing vendor files. The integration uses Application theme, compact density, and the active light/dark scheme. Font family tokens use local fallbacks; no remote font requests are introduced.
