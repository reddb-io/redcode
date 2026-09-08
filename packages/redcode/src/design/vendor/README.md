# Vendored design assets

Retained source assets and licenses from the V1 implementation. SessionV2 no longer serves `/design/vendor/*`; prototypes bundle their dependencies locally. Versions and licenses:

- tailwind.js.txt — @tailwindcss/browser 4.2.4 (MIT)
- daisyui.css.txt, daisyui-themes.css.txt — daisyui 5.5.19 (MIT)
- mermaid.js.txt — mermaid 11.15.0 (MIT)

The .txt suffix preserves the original text imports. These files are retained for attribution and reference.

Also here, not served: export-bundle.js — lavish-axi's self-contained-HTML export (MIT, LICENSE.lavish-axi), with its test suite at test/design/export-bundle.test.js. Three small edits are marked "redcode:" in the file.
Also here, not served: whiteboard-core.js — lavish-axi's pure whiteboard helpers (MIT), used by the pinned frame bundle, with its tests at test/design/whiteboard-core.test.js. Unchanged.
