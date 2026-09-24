export * as DesignPages from "./design-pages"

import { HttpServerResponse } from "effect/unstable/http"
import { appearance } from "@reddb-io/redcode-design/brand.gen"
import { params } from "@reddb-io/redcode-design/params"
import { mountReview } from "@reddb-io/redcode-design/review"
import { reviewCopy } from "@reddb-io/redcode-design/copy"
import { annotations } from "@reddb-io/redcode-design/annotations"
import { viewports } from "@reddb-io/redcode-design/viewports"
import { device } from "@reddb-io/redcode-design/devices"
import { stage } from "@reddb-io/redcode-design/stage"
import { screens } from "@reddb-io/redcode-design/screens"
import { deck, slides } from "@reddb-io/redcode-design/slides"
import { mountPresent } from "@reddb-io/redcode-design/present"
import { designFeed } from "@reddb-io/redcode-design/feed"
import { previewLoading } from "@reddb-io/redcode-design/loading"
import type { Design } from "@reddb-io/redcode-schema/design"
import { DesignExport } from "@reddb-io/redcode-core/design/export"
import { DesignWhiteboard } from "@reddb-io/redcode-core/design/whiteboard"

/**
 * The review page, presenter, previews and whiteboard as this server serves them when Design runs in
 * it. Loaded on demand and never linked into a compiled redcode, where the design app serves them.
 */

export const whiteboard = DesignWhiteboard.frame

export function review(sessionID: string, breakpoints: readonly number[] | undefined) {
  return HttpServerResponse.text(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Design · Redcode</title><link rel="icon" type="image/svg+xml" href="${appearance.favicon}"><style>html,body,#review{height:100%;margin:0}</style></head><body><div id="review"></div><script>(${mountReview.toString()})(document.getElementById("review"), Object.assign(${JSON.stringify({ base: "", sessionID, copy: reviewCopy, appearance, breakpoints }).replaceAll("<", "\\u003c")}, { feed: ${designFeed.toString()}, viewports: ${viewports.toString()}, device: ${device.toString()}, stage: ${stage.toString()}, deck: ${deck.toString()}, loading: ${previewLoading.toString()} }))</script></body></html>`,
    {
      contentType: "text/html",
      headers: {
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; frame-src 'self'; connect-src 'self' data:; worker-src blob:",
      },
    },
  )
}

export async function preview(revision: Design.Revision, directory: string) {
  const html = await DesignExport.html(
    directory,
    revision.document.engine === "html" ? revision.document.entry : "index.html",
  )
  return HttpServerResponse.text(
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">${revision.document.target === "presentation" ? `<script>(${slides.toString()})(${deck.toString()})</script>` : ""}<script>(${screens.toString()})()</script>${html}<script>(${params.toString()})(${JSON.stringify(revision.document.controls ?? []).replaceAll("<", "\\u003c")});(${annotations.toString()})()</script>`,
    { contentType: "text/html", headers: { "cache-control": "private, max-age=31536000, immutable" } },
  )
}

export function present(options: {
  readonly endpoint: string
  readonly designID: string
  readonly view: string
  readonly revision: string | undefined
}) {
  return HttpServerResponse.text(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${reviewCopy.presentTitle} · Redcode</title><link rel="icon" type="image/svg+xml" href="${appearance.favicon}"></head><body><div id="present"></div><script>(${mountPresent.toString()})(document.getElementById("present"), Object.assign(${JSON.stringify({ ...options, copy: reviewCopy }).replaceAll("<", "\\u003c")}, { deck: ${deck.toString()}, stage: ${stage.toString()} }))</script></body></html>`,
    {
      contentType: "text/html",
      headers: {
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; frame-src 'self'; connect-src 'self' data:",
      },
    },
  )
}
