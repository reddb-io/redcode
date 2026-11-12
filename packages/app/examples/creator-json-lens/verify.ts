import assert from "node:assert/strict"
import path from "node:path"
import os from "node:os"
import { chromium, expect } from "@playwright/test"

// Attach to the isolated native Desktop already opened by agent-browser, without launching another app.
const endpoint = process.argv[2]
if (!endpoint) throw new Error("Pass the isolated Desktop CDP URL")
const output = path.resolve(process.argv[3] ?? path.join(os.tmpdir(), "redcode-json-lens"))
const browser = await chromium.connectOverCDP(endpoint)
try {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().startsWith("oc://renderer/"))
  assert.ok(page, "The real native Desktop renderer must already be open")
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const iframe = page.locator('iframe[title="JSON Lens component"]')
  const frame = iframe.contentFrame()
  await expect(frame.getByRole("heading", { name: "JSON Lens", exact: true })).toBeVisible()
  assert.equal(await iframe.getAttribute("sandbox"), "allow-scripts")
  await expect(frame.locator("[data-kpi-card]")).toHaveCount(4)
  await expect(frame.getByRole("region", { name: "Propriedades", exact: true }).locator("[data-kpi-value]")).toHaveText(
    "13",
  )
  await expect(frame.getByRole("region", { name: "Valores", exact: true }).locator("[data-kpi-value]")).toHaveText("11")
  await expect(frame.locator(".result")).toContainText("ana@example.com")
  await frame.getByRole("button", { name: "/orders/0/total", exact: true }).click()
  await expect(frame.locator(".result")).toContainText("149.9")
  const lookup = frame.getByRole("textbox", { name: "Caminho JSON Pointer", exact: true })
  await lookup.fill("/missing")
  await expect(frame.locator(".result")).toContainText("Caminho não encontrado")
  const input = frame.getByRole("textbox", { name: "Documento JSON", exact: true })
  await input.fill('{"a/b":{"~":42},"arr":[1,2],"on":false}')
  await expect(frame.getByRole("region", { name: "Propriedades", exact: true }).locator("[data-kpi-value]")).toHaveText(
    "4",
  )
  await lookup.fill("/a~1b/~0")
  await expect(frame.locator(".result")).toContainText("42")
  await frame.getByRole("button", { name: "Formatar", exact: true }).click()
  assert.ok((await input.inputValue()).includes("\n"), "Format must update the editable document")
  await input.fill("{")
  await expect(frame.getByRole("alert")).toContainText("Não foi possível analisar")
  await expect(frame.getByRole("button", { name: "Formatar", exact: true })).toBeDisabled()
  await frame.getByRole("button", { name: "Restaurar exemplo", exact: true }).click()
  await expect(frame.locator(".result")).toContainText("ana@example.com")
  const customer = frame.getByRole("treeitem", { name: "customer", exact: true })
  await customer.focus()
  await customer.press("ArrowLeft")
  await expect(customer).toHaveAttribute("aria-expanded", "false")
  await customer.press("ArrowRight")
  await expect(customer).toHaveAttribute("aria-expanded", "true")
  await frame.getByRole("button", { name: "Strings 5", exact: true }).click()
  await expect(frame.getByRole("button", { name: "Strings 5", exact: true })).toHaveAttribute("aria-pressed", "true")
  await frame.getByRole("button", { name: "Strings 5", exact: true }).click()
  const geometry = await frame.locator("[data-breakdown-segments]").boundingBox()
  assert.equal(geometry?.height, 6, "The composition remains a delicate 6px bar")
  assert.deepEqual(errors, [], "No unhandled rendering errors during interaction")
  await iframe.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(output, "json-lens-desktop.png") })
  await iframe.screenshot({ path: path.join(output, "json-lens-panel.png") })
  const evidence = {
    host: page.url(),
    sandbox: await iframe.getAttribute("sandbox"),
    barHeight: geometry?.height,
    unhandledErrors: errors,
    verified: [
      "DS metrics from JSON",
      "pointer queries and escapes",
      "invalid paths",
      "format",
      "invalid JSON and recovery",
      "keyboard tree navigation",
      "composition selection",
    ],
  }
  await Bun.write(path.join(output, "verification.json"), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await browser.close()
}
