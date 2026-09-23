# Vendored design assets

Source assets and licenses from the V1 implementation. SessionV2 no longer serves `/design/vendor/*`; prototypes bundle their dependencies locally. Importing a pre-0.22 prototype (`legacy.ts`, through `vendor.ts`) still copies these into it. Versions and licenses:

- tailwind.js.txt — @tailwindcss/browser 4.2.4 (MIT)
- daisyui.css.txt, daisyui-themes.css.txt — daisyui 5.5.19 (MIT)
- mermaid.js.txt — mermaid 11.15.0 (MIT)

The .txt suffix preserves the original text imports.

Also here, not served: whiteboard-core.js — lavish-axi's pure whiteboard helpers (MIT, LICENSE.lavish-axi), built into the pinned frame bundle by script/whiteboard-bundle.ts, with its tests at test/design/whiteboard-core.test.js. Unchanged.
