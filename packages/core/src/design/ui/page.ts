export * as DesignPage from "./page.js"

import type { Design } from "@opencode/schema/design"
import { DesignExport } from "../export.js"
import { appearance, fonts } from "./brand.gen.js"
import { annotations } from "./annotations.js"
import { capture } from "./capture.js"
import captureRuntime from "./vendor/capture/runtime.txt" with { type: "text" }
import { reviewCopy } from "./copy.js"
import { designFeed } from "./feed.js"
import { previewLoading } from "./loading.js"
import { params } from "./params.js"
import { liveFrame, liveHost } from "./live.js"
import { mountPresent } from "./present.js"
import { mountReview } from "./review.js"
import { screens } from "./screens.js"
import { stage } from "./stage.js"
import { deck, slides } from "./slides.js"
import { device } from "./devices.js"
import { viewports } from "./viewports.js"

export const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; frame-src 'self'; connect-src 'self' data:; worker-src blob:"

/** The sandboxed frame's own policy: no network and no devices. */
export const FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"

/**
 * A policy widened by a design's live grant: its origins join connect-src and script-src, and media may play from
 * them and from blob: and data: URLs. A frame written with srcdoc enforces its page's policy as well as its own, so
 * the review and presentation pages grow by the same origins as the frame. Without a grant nothing changes.
 */
export function livePolicy(policy: string, grant: Design.Live | undefined) {
  if (!grant?.microphone && !grant?.origins?.length) return policy
  const origins = grant.origins ?? []
  const directives = policy.split("; ")
  return [
    ...directives.map((directive) => {
      const parts = directive.split(" ")
      if (!origins.length || (parts[0] !== "connect-src" && parts[0] !== "script-src")) return directive
      return [...parts.filter((part) => part !== "'none'"), ...origins].join(" ")
    }),
    ...(directives.some((directive) => directive.startsWith("media-src "))
      ? []
      : [["media-src", "'self'", "blob:", "data:", ...origins].join(" ")]),
  ].join("; ")
}

/**
 * A review link's ticket is spent once the page loads: the server exchanged it for the review cookie. Dropping it
 * from the address keeps it out of bookmarks, copies and history, and a reload signs in with the cookie.
 */
const UNTICKET =
  'if(new URLSearchParams(location.search).has("ticket")){const u=new URL(location.href);u.searchParams.delete("ticket");history.replaceState(history.state,"",u)};'

/**
 * The browser review keeps its conversation and controls in the trusted shell. `embedded` leaves out the views that
 * repeat the conversation of the session shown beside it (see `ReviewOptions.embedded`).
 */
export function review(sessionID: string, endpoint: string, breakpoints?: readonly number[], embedded = false) {
  const options = JSON.stringify({
    base: "",
    endpoint,
    sessionID,
    copy: reviewCopy,
    appearance,
    breakpoints,
    embedded,
    shortcuts: embedded ? "scoped" : "global",
  }).replaceAll("<", "\\u003c")
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Design · Redcode</title><link rel="icon" type="image/svg+xml" href="${appearance.favicon}"><style>${fonts}</style><style>html,body,#review{height:100%;margin:0}</style></head><body><div id="review"></div><script>${UNTICKET}(${mountReview.toString()})(document.getElementById("review"), Object.assign(${options}, { feed: ${designFeed.toString()}, viewports: ${viewports.toString()}, device: ${device.toString()}, stage: ${stage.toString()}, deck: ${deck.toString()}, loading: ${previewLoading.toString()}, live: ${liveHost.toString()} }))</script></body></html>`
}

export function present(
  endpoint: string,
  designID: string,
  view: "audience" | "presenter",
  revision?: string,
  grant?: Design.Live,
) {
  const options = JSON.stringify({
    endpoint,
    designID,
    view,
    revision,
    copy: reviewCopy,
    microphone: grant?.microphone === true,
  }).replaceAll("<", "\\u003c")
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${reviewCopy.presentTitle} · Redcode</title><link rel="icon" type="image/svg+xml" href="${appearance.favicon}"></head><body><div id="present"></div><script>${UNTICKET}(${mountPresent.toString()})(document.getElementById("present"), Object.assign(${options}, { deck: ${deck.toString()}, stage: ${stage.toString()}, live: ${liveHost.toString()} }))</script></body></html>`
}

/**
 * Model-written markup is displayed only inside the review's sandboxed iframe. `grant` is the design's live grant as
 * it stands now, so approving or revoking one applies to every revision without publishing another.
 */
export async function preview(revision: Design.Revision, directory: string, grant?: Design.Live) {
  const html = await DesignExport.html(
    directory,
    revision.document.engine === "html" ? revision.document.entry : "index.html",
    grant?.origins,
  )
  const controls = JSON.stringify(revision.document.controls ?? []).replaceAll("<", "\\u003c")
  return `<meta http-equiv="Content-Security-Policy" content="${livePolicy(FRAME_CSP, grant)}">${grant?.microphone ? `<script>(${liveFrame.toString()})()</script>` : ""}${revision.document.target === "presentation" ? `<script>(${slides.toString()})(${deck.toString()})</script>` : ""}<script>(${screens.toString()})()</script>${html}<script>(${params.toString()})(${controls});(${annotations.toString()})();(function(module,exports,define){${captureRuntime.replaceAll("</script", "<\\/script")}
}).call(window);(${capture.toString()})(window.domtoimage?.toCanvas,${JSON.stringify(revision.id)});</script>`
}
