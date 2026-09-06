---
"@reddb-io/redcode": minor
"@reddb-io/redcode-core": minor
---

Design mode: a self-contained export, and the review from another device

`design_export` (and ⋮ → Export standalone HTML on the review page) writes the prototype as one HTML file with its own stylesheets, classic scripts, images, fonts and media inlined, along with the Tailwind, DaisyUI and Mermaid redcode serves, so it opens from disk or anywhere with no redcode running. Remote references are left for the browser; nothing is fetched, and every local read is confined to the prototype directory by real path, so a symlink cannot carry an outside file into a page that may be shared. What could not be inlined is listed for the agent and counted for the person. The transform is lavish-axi's export bundler, vendored whole with its tests. Caps under `experimental.design.export` (10 MB per asset, 25 MB per export). When the server listens beyond loopback, `design_preview` prints the URL a phone on the same network can open and the page offers it under ⋮; the review surface now answers only under names that are this machine (loopback, the bound hostname, its addresses and its own name, plus `experimental.design.hosts`), so a page elsewhere that resolves its name here cannot drive it.
