import { expect, test } from "bun:test"
import { CreatorFrame } from "../src/creator/frame"

const policy =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'\">"

test("Creator diagnostics preserve the Design policy and run before the first artifact script", () => {
  const artifact = '<script>throw new Error("broken component")</script><main>My component</main>'
  const rendered = CreatorFrame.html(policy + artifact)
  expect(rendered.startsWith(policy)).toBe(true)
  expect(rendered.indexOf("redcode:creator-error")).toBeLessThan(
    rendered.indexOf('throw new Error("broken component")'),
  )
  expect(rendered).toEndWith(artifact)
  expect(rendered.match(/<\/script>/g)).toHaveLength(2)
  expect(rendered).toContain('"unhandledrejection"')
})

test("Creator diagnostics reject missing or late policies instead of weakening isolation", () => {
  expect(() => CreatorFrame.html("<main>Missing policy</main>")).toThrow("content security policy")
  expect(() => CreatorFrame.html("<script>run()</script>" + policy)).toThrow("before its scripts")
})
