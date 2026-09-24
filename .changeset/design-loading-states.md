---
"@reddb-io/redcode": patch
"@reddb-io/redcode-design-app": patch
---

Design's review page no longer shows a blank white box while a revision loads. The preview area keeps the theme background and a skeleton of the target (slide strip and 16:9 canvas, phone frame, or page) with the current stage and its elapsed time — waiting for the build, preparing the design tools on first use, building, loading assets and fonts, starting the preview — and fades the frame in once its runtime is ready. Before the first revision it says the agent is preparing it and shows what the agent is doing; a failed build shows its summary with Retry. The presenter windows wait the same way. The first download of the design app shows its progress in the TUI, and a review link opened meanwhile shows a page that follows the download instead of a connection error.
