import { describe, expect, test } from "bun:test"
import { OauthCallbackPage } from "../src/oauth/page"

describe("OauthCallbackPage", () => {
  test("escapes provider names and error details in the standalone page", () => {
    const html = OauthCallbackPage.error('<script>alert("error")</script>', { provider: '<img src=x>' })
    expect(html).toContain("&lt;img src=x&gt;")
    expect(html).toContain("&lt;script&gt;alert(&quot;error&quot;)&lt;/script&gt;")
    expect(html).not.toContain('<script>alert("error")</script>')
  })

  test("escapes bootstrap options embedded in the inline script", () => {
    const html = OauthCallbackPage.bootstrap({
      provider: `xAI</script><script>alert("provider")</script>`,
      tokenPath: `/token</script><script>alert("path")</script>`,
    })

    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).toContain(`xAI\\u003c/script>\\u003cscript>alert(\\\"provider\\\")\\u003c/script>`)
    expect(html).toContain(`/token\\u003c/script>\\u003cscript>alert(\\\"path\\\")\\u003c/script>`)
  })
})
