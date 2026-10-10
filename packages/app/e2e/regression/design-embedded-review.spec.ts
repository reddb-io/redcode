import { expect, test } from "@playwright/test"
import { mountReview } from "../../../core/src/design/ui/review"
import { reviewCopy } from "../../../core/src/design/ui/copy"
import { previewLoading } from "../../../core/src/design/ui/loading"
import { stage } from "../../../core/src/design/ui/stage"

// Runs the shipping serialized surface: an embedded review must not reconstruct the chat beside it.
for (const embedded of [true, false]) {
  test(`Design ${embedded ? "embedded" : "standalone"} keeps its own review controls and conversation scope`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    const options = JSON.stringify({
      base: "",
      endpoint: "/review-api",
      sessionID: "ses_design_embed",
      copy: reviewCopy,
      embedded,
      shortcuts: embedded ? "scoped" : "global",
    })
    await page.route("**/embedded-review", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<input id="chat" aria-label="Adjacent chat"><div id="review" style="height:800px"></div><script>(${mountReview.toString()})(document.getElementById('review'), Object.assign(${options}, {loading:${previewLoading.toString()},stage:${stage.toString()},feed:(_url,_request,_signal,onEvent)=>{document.getElementById("review").setAttribute("data-feed-url",_url);onEvent({type:'state',state:'working',seq:1,at:1});onEvent({type:'reply',id:'reply_1',text:'Duplicate conversation',seq:2,at:2});onEvent({type:'user',id:'user_1',text:'Duplicate user message',notes:0,seq:3,at:3});onEvent({type:'tool',id:'tool_1',tool:'read',status:'done',summary:'Read a file',seq:4,at:4})}}))</script>`,
      }),
    )
    await page.route("**/review-api**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }))
    await page.goto("/embedded-review")
    const review = page.locator("#review")
    await expect(review.locator("#reply")).toHaveCount(embedded ? 0 : 1)
    await expect(review.locator("#activity")).toHaveCount(embedded ? 0 : 1)
    await expect(review.locator("#round-message")).toHaveCount(embedded ? 0 : 1)
    await expect(review.locator("#note")).toHaveCount(1)
    await expect(review.locator("#preview")).toHaveCount(1)
    await expect(review.locator("#approve")).toHaveCount(1)
    await page.getByRole("textbox", { name: "Adjacent chat" }).fill("v")
    await page.getByRole("textbox", { name: "Adjacent chat" }).press("a")
    await expect(page.getByRole("textbox", { name: "Adjacent chat" })).toHaveValue("va")
    await expect(review).toHaveAttribute("data-feed-url", `/review-api/feed${embedded ? "?embed=1" : ""}`)
    expect(errors).toEqual([])
  })
}
