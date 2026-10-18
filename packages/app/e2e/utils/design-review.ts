import type { Page } from "@playwright/test"
import { Design } from "@opencode/schema/design"
import { Session } from "@opencode/schema/session"
import { mountReview } from "../../../core/src/design/ui/review"
import { reviewCopy } from "../../../core/src/design/ui/copy"
import { appearance } from "../../../core/src/design/ui/brand.gen"
import { previewLoading } from "../../../core/src/design/ui/loading"
import { stage } from "../../../core/src/design/ui/stage"
import { device } from "../../../core/src/design/ui/devices"
import { annotations } from "../../../core/src/design/ui/annotations"

/** The serialized shipping review, with its real DS styles and an isolated design awaiting its first preview. */
export async function openDesignReview(
  page: Page,
  embedded: boolean,
  input: {
    target?: Design.Surface
    published?: boolean
    assessment?: "completed" | "unavailable"
  } = {},
) {
  const document: Design.Info = {
    id: Design.ID.make("design_inspector"),
    sessionID: Session.ID.make("ses_design_embed"),
    name: "Checkout",
    journey: "new",
    engine: "html",
    kind: "screen",
    target: input.target ?? "web",
    artboard: { width: 600, height: 600 },
    root: "/project",
    application: ".",
    entry: "index.html",
    brief: {
      objective: "Review checkout",
      audience: "Customers",
      content: "Checkout",
      constraints: "",
      references: [],
    },
    decisions: [],
    questions: [],
    scenarios: [],
    designSystem: "RedDB",
    sources: [],
    tweaks: {},
    revision: input.published ? "rev_canvas" : null,
    approvedRevision: null,
    ended: false,
    updated: 1,
  }
  const revision: Design.Revision = {
    id: "rev_canvas",
    designID: document.id,
    parent: null,
    name: "Checkout canvas",
    created: 1,
    files: {},
    document,
  }
  const job = {
    designID: document.id,
    status: "completed" as const,
    progress: 1,
    result: null,
    error: null,
    created: 2,
  }
  const jobs: Design.Job[] = !input.assessment
    ? []
    : [
        {
          ...job,
          id: "job_audit",
          input: { revision: "rev_canvas", format: "audit" },
          audit: {
            revision: "rev_canvas",
            findings: ["Checkout needs a larger target"],
            scenarios: ["Checkout"],
            widths: [390],
            checks: [
              {
                rule: "small-control",
                severity: "review",
                selector: "#checkout",
                evidence: "Target is 20px high.",
                fix: "Increase the touch target.",
                width: 390,
              },
            ],
            reuse: { imported: ["Button", "Card", "Input"], redeclared: ["Button"], files: [], ratio: 0.75 },
          },
        },
        {
          ...job,
          id: "job_analysis",
          input: { revision: "rev_canvas", format: "analysis" },
          assessment: {
            revision: "rev_canvas",
            basis: "rendered-images",
            status: input.assessment,
            judgments:
              input.assessment === "unavailable"
                ? []
                : [
                    {
                      id: "hierarchy",
                      label: "Visual hierarchy",
                      value: "Clear",
                      followUp: "Keep the primary action prominent.",
                    },
                  ],
            evidence: [{ width: 390, height: 844, screen: "Checkout", content: "Checkout primary action" }],
            limitations: ["The payment flow was not exercised."],
          },
        },
      ]
  const options = JSON.stringify({
    base: "",
    endpoint: "/review-api",
    sessionID: "ses_design_embed",
    copy: reviewCopy,
    appearance,
    embedded,
    shortcuts: embedded ? "scoped" : "global",
  }).replaceAll("<", "\\u003c")
  await page.route("**/embedded-review", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><input id="chat" aria-label="Adjacent chat"><div id="review" style="height:min(800px,calc(100dvh - 44px))"></div><script>(${mountReview.toString()})(document.getElementById('review'), Object.assign(${options}, {device:${device.toString()},loading:${previewLoading.toString()},stage:${stage.toString()},feed:(_url,_request,_signal,onEvent)=>{document.getElementById("review").setAttribute("data-feed-url",_url);onEvent({type:'state',state:'working',seq:1,at:1});onEvent({type:'reply',id:'reply_1',text:'Duplicate conversation',seq:2,at:2});onEvent({type:'user',id:'user_1',text:'Duplicate user message',notes:0,seq:3,at:3});onEvent({type:'tool',id:'tool_1',tool:'read',status:'done',summary:'Read a file',seq:4,at:4})}}))</script>`,
    }),
  )
  await page.route("**/review-api**", (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/preview"))
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><style>body{margin:0;padding:40px;background:#f8fafc;font:16px system-ui}button{width:180px;height:48px}label{display:block;margin-top:20px}input{font:inherit}</style><h1>Checkout</h1><button id="checkout">Checkout action</button><label>Prototype state<input aria-label="Prototype state"></label><script>(${annotations.toString()})();parent.postMessage({type:"design:ready"},"*")</script>`,
      })
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        path === "/review-api"
          ? [document]
          : path.endsWith("/revision")
            ? [revision]
            : path.endsWith("/job")
              ? jobs
              : [],
      ),
    })
  })
  await page.goto("/embedded-review")
  return page.locator("#review")
}
