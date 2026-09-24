# Legacy prototype assets

Source assets and licenses from the V1 implementation. Nothing serves `/design/vendor/*` any more; prototypes bundle their dependencies locally. Importing a pre-0.22 prototype still copies these into it: the design app serves them to redcode (`/app/vendor/<file>`), and a source checkout reads them through `src/vendor.ts`. Versions and licenses:

- tailwind.js.txt — @tailwindcss/browser 4.2.4 (MIT)
- daisyui.css.txt, daisyui-themes.css.txt — daisyui 5.5.19 (MIT)
- mermaid.js.txt — mermaid 11.15.0 (MIT)

The .txt suffix preserves the original text imports.
