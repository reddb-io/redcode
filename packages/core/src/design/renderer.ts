/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="dom.asynciterable" />
/// <reference path="./gifenc.d.ts" />
export * as DesignRenderer from "./renderer"

import path from "node:path"
import { createRequire } from "node:module"
import { rm } from "node:fs/promises"
import { Cause, Context, Effect, Fiber, Layer, Scope, Semaphore } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Design } from "@reddb-io/redcode-schema/design"
import { makeLocationNode } from "../effect/app-node"
import { AppProcess } from "../process"
import { DesignStore } from "./store"
import { DesignBuild } from "./build"
import { DesignFiles } from "./files"
import { DesignExport } from "./export"
import { DesignAssets } from "./assets"
import { DesignRaster } from "./raster"
import { DesignRuntime } from "./runtime"
import { DesignQuality } from "./quality"
import { DesignRounds } from "./rounds"
import { screens } from "@reddb-io/redcode-design/screens"

/**
 * In-page helpers. Each is serialized on its own, so they reach the runtime through its private handle
 * (a prototype may define its own window.design) and check every method before calling it.
 */
type ScreenHandle = {
  __redcodeDesign?: {
    open?: (screen: string, variant?: string) => boolean
    screens?: () => { id: string; variant: string }[]
    current?: () => Record<string, string>
  }
}
/** Opens a screen; false when the prototype has no such screen in that variant or on the page. */
const openScreen = (input: { screen: string; variant?: string }) => {
  const api = (window as unknown as ScreenHandle).__redcodeDesign
  return typeof api?.open === "function" && api.open(input.screen, input.variant) === true
}
/** True once the runtime lists the screen, in the variant or on the page; screens can mount late. */
const listsScreen = (input: { screen: string; variant?: string }) => {
  const api = (window as unknown as ScreenHandle).__redcodeDesign
  return (
    typeof api?.screens === "function" &&
    api
      .screens()
      .some(
        (item) =>
          item.id === input.screen &&
          (input.variant === undefined || item.variant === input.variant || item.variant === ""),
      )
  )
}
const anyScreen = () => {
  const api = (window as unknown as ScreenHandle).__redcodeDesign
  return typeof api?.screens === "function" && api.screens().length > 0
}
const declaredScreens = () => {
  const api = (window as unknown as ScreenHandle).__redcodeDesign
  return typeof api?.screens === "function" ? api.screens() : []
}
const currentScreens = () => {
  const api = (window as unknown as ScreenHandle).__redcodeDesign
  return typeof api?.current === "function" ? api.current() : {}
}

/**
 * Locates a review note's element in the rendered page: by its data-design-id, then by the selector
 * the review frame recorded (within its variant root, else outside every variant), then by XPath.
 * Marks the element and its container so the checks that follow can address them, and scrolls the
 * element into view so a focused capture shows it. Runs inside the page; self-contained.
 */
type Rect = { x: number; y: number; width: number; height: number }
type Located = { found: false; how: string } | { found: true; how: string; rect: Rect; container: Rect }
const locateNote = (input: { target: string; xpath: string; variant: string }): Located => {
  document.querySelectorAll("[data-redcode-verify]").forEach((node) => node.removeAttribute("data-redcode-verify"))
  const root = input.variant ? document.querySelector(`[data-design-variant="${input.variant}"]`) : null
  if (input.variant && !root) return { found: false, how: "variant missing" }
  const scope: ParentNode = root ?? document
  const query = input.target.replace(/^variant:[a-zA-Z0-9_-]{1,64} /, "")
  const attempt = (how: string, find: () => Element | null | undefined) => {
    try {
      const node = find()
      return node instanceof HTMLElement || node instanceof SVGElement ? { node, how } : undefined
    } catch {
      return undefined
    }
  }
  const design = /\[data-design-id="([^"]+)"\]/.exec(query)?.[1]
  const outside = (found: Element[]) => found.find((node) => !node.closest("[data-design-variant]"))
  const hit =
    (design && attempt("data-design-id", () => scope.querySelector(`[data-design-id="${CSS.escape(design)}"]`))) ||
    (query &&
      query !== "page" &&
      query !== "diagram" &&
      (attempt("selector", () => scope.querySelector(query)) ||
        (root && attempt("selector", () => outside([...document.querySelectorAll(query)]))))) ||
    (input.xpath &&
      attempt("xpath", () => {
        const node = document.evaluate(
          input.xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue
        return node instanceof Element && (!root || root.contains(node)) ? node : undefined
      }))
  if (!hit) return { found: false, how: "not found" }
  const element = hit.node as Element
  // The container is the nearest keyed or landmark ancestor; the scoped checks run inside it.
  const containers =
    "[data-design-id], [data-design-screen], section, article, main, header, nav, aside, footer, dialog, form, fieldset, table, ul, ol, li, tr"
  const container =
    (element.parentElement?.closest(containers) as HTMLElement | null) ?? element.parentElement ?? document.body
  element.setAttribute("data-redcode-verify", "target")
  if (container !== element) container.setAttribute("data-redcode-verify", "container")
  element.scrollIntoView({ block: "center", inline: "nearest" })
  const box = element.getBoundingClientRect()
  const around = (container === element ? element : container).getBoundingClientRect()
  return {
    found: true,
    how: hit.how,
    rect: { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height },
    container: { x: around.x + scrollX, y: around.y + scrollY, width: around.width, height: around.height },
  }
}

/** Layout facts about the marked element and its container, plus which of the page-wide checks fall inside it. */
const scopedLayout = (selectors: string[]) => {
  const target = document.querySelector<HTMLElement>('[data-redcode-verify="target"]')
  const container = document.querySelector<HTMLElement>('[data-redcode-verify="container"]') ?? target
  const findings: string[] = []
  if (target) {
    const box = target.getBoundingClientRect()
    const style = getComputedStyle(target)
    if (box.width === 0 || box.height === 0 || style.visibility === "hidden" || style.display === "none")
      findings.push("element is not rendered (zero size or hidden)")
    else if (box.right > innerWidth + 1 || box.left < -1) findings.push("element extends past the viewport width")
  }
  if (
    container &&
    container.scrollWidth > container.clientWidth + 1 &&
    getComputedStyle(container).overflowX === "visible"
  )
    findings.push(`container overflows horizontally by ${container.scrollWidth - container.clientWidth}px`)
  const inside = selectors.filter((selector) => {
    try {
      const node = document.querySelector(selector)
      return !!node && !!container && (container === node || container.contains(node))
    } catch {
      return false
    }
  })
  return { findings, inside }
}

/**
 * Adds the screen runtime to a standalone HTML document: after <head>, else after <html>, else after
 * the doctype, so it never lands before the doctype or inside a <header>.
 */
export function injectScreens(html: string) {
  const tag = `<script>(${screens.toString()})()</script>`
  for (const pattern of [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
    const match = pattern.exec(html)
    if (match) return html.slice(0, match.index + match[0].length) + tag + html.slice(match.index + match[0].length)
  }
  return tag + html
}

const io = <A>(run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => new Design.Error({ code: "unavailable", message: DesignBuild.reason(error) }),
  })

const make = Effect.gen(function* () {
  const store = yield* DesignStore.Service
  const processes = yield* AppProcess.Service
  const scope = yield* Scope.Scope
  const lock = yield* Semaphore.make(1)
  const active = new Map<string, Fiber.Fiber<void, Design.Error>>()
  const builds = new Map<string, Promise<string>>()

  const directory = (revision: Design.Revision) =>
    io(() => {
      const existing = builds.get(revision.id)
      if (existing) return existing
      const pending = DesignBuild.build(
        revision,
        store.blobs,
        path.join(store.storage, revision.designID, "builds", revision.id),
      )
      builds.set(revision.id, pending)
      pending.catch(() => builds.delete(revision.id))
      return pending
    })

  const browser = Effect.gen(function* () {
    const { chromium } = yield* io((signal) => DesignRuntime.load("playwright-core", signal))
    if (!(yield* io(() => Bun.file(chromium.executablePath()).exists()))) {
      const entry = yield* io((signal) => DesignRuntime.resolve("playwright-core", signal))
      const require = createRequire(entry)
      const cli = path.join(path.dirname(require.resolve("playwright-core/package.json")), "cli.js")
      yield* processes
        .run(
          ChildProcess.make(process.execPath, [cli, "install", "chromium"], {
            env: { BUN_BE_BUN: "1" },
            extendEnv: true,
          }),
          {
            maxOutputBytes: 4000,
            timeout: "3 minutes",
          },
        )
        .pipe(
          Effect.flatMap(AppProcess.requireSuccess),
          Effect.mapError(
            () =>
              new Design.Error({
                code: "unavailable",
                message:
                  "Chromium setup failed or exceeded its three-minute limit. Check access to Playwright's browser download service and retry, or select a preinstalled cache with PLAYWRIGHT_BROWSERS_PATH.",
              }),
          ),
        )
    }
    const server = yield* Effect.acquireRelease(
      io(() => chromium.launchServer({ headless: true, host: "127.0.0.1", timeout: 15000 })),
      (server) =>
        Effect.promise(() => server.kill()).pipe(
          Effect.interruptible,
          Effect.timeout("3 seconds"),
          Effect.catch(() => Effect.void),
        ),
    )
    return yield* Effect.acquireRelease(
      io(() => chromium.connect(server.wsEndpoint(), { timeout: 15000 })),
      (browser) =>
        Effect.promise(() => browser.close()).pipe(
          Effect.interruptible,
          Effect.timeout("3 seconds"),
          Effect.catch(() => Effect.void),
        ),
    )
  })

  const render = Effect.fn("DesignRenderer.render")(function* (job: Design.Job) {
    const report: { audit?: Design.Audit; verify?: Design.Verify } = {}
    const started = Date.now()
    yield* store.putJob({ ...job, status: "running", started })
    const revision = yield* store.revision(job.designID, job.input.revision)
    const root = yield* directory(revision)
    const progress = (value: number) => store.putJob({ ...job, status: "running", started, progress: value })
    const output = path.join(
      store.storage,
      job.designID,
      "exports",
      `${job.id}.${job.input.format === "gif" ? "gif" : "html"}`,
    )
    yield* Effect.scoped(
      Effect.gen(function* () {
        const instance = yield* browser
        const context = yield* io(() =>
          instance.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" }),
        )
        // Screens and the design helper run before the prototype's scripts, as in the review page. A
        // compare injects them only into the approved prototype, never into the implementation.
        if (job.input.format !== "compare")
          yield* io(() => context.addInitScript({ content: `(${screens.toString()})()` }))
        const page = yield* io(() => context.newPage())
        yield* io(() =>
          page.route("**/*", async (route) => {
            const url = new URL(route.request().url())
            if (url.origin !== "http://design.local") {
              await route.abort()
              return
            }
            const file = await DesignFiles.resolve(
              root,
              decodeURIComponent(url.pathname.slice(1)) || "index.html",
            ).catch(() => undefined)
            if (!file) {
              await route.fulfill({ status: 404, body: "Not found" })
              return
            }
            await route.fulfill({ body: Buffer.from(await Bun.file(file).bytes()), contentType: Bun.file(file).type })
          }),
        )
        const entry = revision.document.engine === "html" ? revision.document.entry : "index.html"
        if (job.input.format !== "gif")
          yield* io(() => page.goto(`http://design.local/${entry}`, { waitUntil: "load" }))
        yield* io(() => page.evaluate(() => document.fonts.ready.then(() => undefined)))

        if (job.input.format === "gif") {
          if (!job.input.asset) return yield* new Design.Error({ code: "invalid", message: "Choose an SVG asset" })
          const asset = yield* store.asset(job.designID, job.input.asset)
          if (asset.mime !== "image/svg+xml")
            return yield* new Design.Error({ code: "invalid", message: "GIF export requires an SVG source" })
          const svg = Buffer.from(yield* store.readBlob(asset.hash)).toString("utf8")
          if (/<script\b|\bon\w+\s*=|javascript\s*:/i.test(svg))
            return yield* new Design.Error({
              code: "invalid",
              message: "Use CSS or SMIL animation without scripts in SVG exports",
            })
          const raster = yield* DesignRaster.make
          const size = job.input.size ?? 512
          const duration = job.input.duration ?? 3
          const fps = job.input.fps ?? 20
          const background = job.input.transparent ? "transparent" : (job.input.background ?? "#f8f8f6")
          if (!/^(?:transparent|#[0-9a-fA-F]{3,8})$/.test(background))
            return yield* new Design.Error({ code: "invalid", message: "Choose a hexadecimal background color" })
          yield* io(async () => DesignAssets.svg(svg))
          yield* io(() =>
            page.setContent(
              `<html><head><style>html,body{margin:0;background:${background};overflow:hidden}svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`,
            ),
          )
          const dimensions = yield* io(() =>
            page.evaluate((size) => {
              const svg = document.querySelector("svg")
              if (!svg) throw new Error("The source contains no SVG")
              const viewBox = svg.viewBox.baseVal
              const width = viewBox.width || svg.width.baseVal.value || size
              const height = viewBox.height || svg.height.baseVal.value || size
              return {
                width: Math.max(1, Math.round((size * width) / Math.max(width, height))),
                height: Math.max(1, Math.round((size * height) / Math.max(width, height))),
              }
            }, size),
          )
          yield* io(() => page.setViewportSize(dimensions))
          yield* io(() => page.evaluate(() => document.fonts.ready.then(() => undefined)))
          const frames = Math.ceil(duration * fps)
          for (const frame of Array.from({ length: frames }, (_, index) => index)) {
            yield* io(() =>
              page.evaluate((time) => {
                document.querySelectorAll("svg").forEach((svg) => {
                  svg.pauseAnimations()
                  svg.setCurrentTime(time)
                })
                document.getAnimations().forEach((animation) => {
                  animation.pause()
                  animation.currentTime = time * 1000
                })
              }, frame / fps),
            )
            yield* raster.frame(
              {
                png: yield* io(() =>
                  page.screenshot({ omitBackground: job.input.transparent ?? false, animations: "allow" }),
                ),
                frame,
                fps,
                repeat: job.input.repeat ?? 0,
                transparent: job.input.transparent ?? false,
              },
              true,
            )
            yield* progress((frame + 1) / frames)
            yield* Effect.yieldNow
          }
          const bytes = yield* raster.finish()
          yield* io(() => DesignFiles.atomic(output, bytes))
        }

        if (job.input.format === "html") {
          const html = yield* io(() => DesignExport.html(root, entry))
          // The exported page keeps working screens without the review page around it.
          yield* io(() => DesignFiles.atomic(output, injectScreens(html)))
        }

        if (job.input.format === "compare") {
          if (!job.input.candidate)
            return yield* new Design.Error({ code: "invalid", message: "Implementation snapshot is missing" })
          const candidate = yield* store.revision(job.designID, job.input.candidate)
          const candidateRoot = yield* directory(candidate)
          const raster = yield* DesignRaster.make
          const report: string[] = []
          const escape = (value: string) =>
            value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
          const scenarios = revision.document.scenarios.filter((scenario) => !scenario.notApplicable)
          if (!scenarios.length)
            report.push("<p>No acceptance scenarios were supplied. These screenshots require manual review.</p>")
          for (const width of [390, 768, 1440]) {
            const images: Buffer[] = []
            for (const source of [root, candidateRoot]) {
              yield* io(() => page.unrouteAll())
              yield* io(() =>
                page.route("**/*", async (route) => {
                  const url = new URL(route.request().url())
                  if (url.origin !== "http://design.local") {
                    await route.abort()
                    return
                  }
                  const file = await DesignFiles.resolve(
                    source,
                    decodeURIComponent(url.pathname.slice(1)) || "index.html",
                  ).catch(() => undefined)
                  if (!file) {
                    await route.fulfill({ status: 404 })
                    return
                  }
                  const bytes = Buffer.from(await Bun.file(file).bytes())
                  await route.fulfill({
                    body:
                      source === root && route.request().resourceType() === "document"
                        ? injectScreens(bytes.toString("utf8"))
                        : bytes,
                    contentType: Bun.file(file).type,
                  })
                }),
              )
              yield* io(() => page.setViewportSize({ width, height: 900 }))
              for (const scenario of scenarios.length ? scenarios : [undefined]) {
                yield* io(() => page.goto(`http://design.local/${source === root ? entry : "index.html"}`))
                yield* io(() => page.evaluate(() => document.fonts.ready.then(() => undefined)))
                const outcome = yield* io(async () => {
                  if (scenario?.params)
                    await page.evaluate(
                      (values) => {
                        window.dispatchEvent(new CustomEvent("design:params", { detail: { values, reset: true } }))
                      },
                      Object.fromEntries(
                        (revision.document.controls ?? []).map((component) => [
                          component.id,
                          {
                            ...Object.fromEntries(component.fields.map((field) => [field.id, field.default])),
                            ...scenario.params?.[component.id],
                          },
                        ]),
                      ),
                    )
                  // Only the approved prototype has screens; the implementation reaches the state its own way.
                  if (scenario?.screen && source === root) {
                    await page
                      .waitForFunction(listsScreen, { screen: scenario.screen }, { timeout: 2000 })
                      .catch(() => undefined)
                    if (!(await page.evaluate(openScreen, { screen: scenario.screen })))
                      return `screen ${scenario.screen} does not exist`
                  }
                  for (const action of scenario?.actions ?? []) {
                    const target = page.locator(action.selector)
                    if (action.action === "click") await target.click({ timeout: 5000 })
                    if (action.action === "fill") await target.fill(action.value ?? "", { timeout: 5000 })
                    if (action.action === "press") await target.press(action.value ?? "Enter", { timeout: 5000 })
                  }
                  if (!scenario) return "Manual visual review"
                  const target = page.locator(scenario.selector)
                  await target.waitFor({ state: "visible", timeout: 5000 })
                  return (await target.getAttribute("data-state")) === scenario.state ? "Exercised" : "State mismatch"
                }).pipe(Effect.catchTag("Design.Error", (error) => Effect.succeed(error.message)))
                const screenshot = yield* io(() => page.screenshot({ animations: "disabled" }))
                images.push(screenshot)
                report.push(
                  `<h2>${width}px · ${source === root ? "Approved" : "Implementation"} · ${escape(scenario?.name ?? "Page")}</h2><p>${escape(outcome)}</p><img style="max-width:100%" alt="Rendered comparison" src="data:image/png;base64,${screenshot.toString("base64")}">`,
                )
              }
            }
            const count = Math.max(1, scenarios.length)
            for (const index of Array.from({ length: count }, (_, index) => index)) {
              const different = yield* raster.compare(images[index], images[index + count], true)
              report.push(
                `<p>${width}px · ${escape(scenarios[index]?.name ?? "Page")}: ${different.toFixed(2)}% of pixels changed. This is visual evidence, not automatic approval.</p>`,
              )
            }
            yield* progress([390, 768, 1440].indexOf(width) / 3 + 1 / 3)
          }
          yield* io(() =>
            DesignFiles.atomic(
              output,
              `<!doctype html><meta charset="utf-8"><title>Approved design comparison</title><h1>${escape(revision.document.name)}</h1><p>Approved ${escape(revision.id)} · implementation ${escape(candidate.id)}</p>${report.join("\n")}`,
            ),
          )
        }

        if (job.input.format === "verify") {
          const current = yield* store.get(job.designID)
          const round = job.input.round ?? DesignRounds.latest(current)?.number
          const roundInfo = current.rounds?.find((item) => item.number === round)
          const notes = round === undefined ? [] : DesignRounds.notes(current, round)
          if (round === undefined || !roundInfo || !notes.length)
            return yield* new Design.Error({
              code: "invalid",
              message: round === undefined ? "No feedback round to verify yet" : `Round ${round} has no notes`,
            })
          const LIMIT = 24
          const WIDTH = 1440
          const findings: string[] = []
          type Draft = {
            -readonly [K in keyof Design.VerifyNote]: Design.VerifyNote[K] extends ReadonlyArray<string>
              ? string[]
              : Design.VerifyNote[K]
          }
          const results: Draft[] = []
          const runtimeErrors: string[] = []
          page.on("pageerror", (error) => runtimeErrors.push(error.message))
          if (notes.length > LIMIT)
            findings.push(
              `Only the first ${LIMIT} of ${notes.length} notes were verified; verify the rest in another job.`,
            )
          const { AxeBuilder } = yield* io((signal) => DesignRuntime.load("@axe-core/playwright", signal))
          const escape = (value: string) =>
            value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
          /** Serves one revision's build at design.local, with the screen runtime the review page adds. */
          const serve = (source: string) =>
            io(async () => {
              await page.unrouteAll()
              await page.route("**/*", async (route) => {
                const url = new URL(route.request().url())
                if (url.origin !== "http://design.local") {
                  await route.abort()
                  return
                }
                const file = await DesignFiles.resolve(
                  source,
                  decodeURIComponent(url.pathname.slice(1)) || "index.html",
                ).catch(() => undefined)
                if (!file) {
                  await route.fulfill({ status: 404, body: "Not found" })
                  return
                }
                await route.fulfill({
                  body: Buffer.from(await Bun.file(file).bytes()),
                  contentType: Bun.file(file).type,
                })
              })
            })
          /** The built directory of the revision a note was taken on; undefined when it cannot be rendered. */
          const previous = new Map<string, string | undefined>()
          const before = (revisionID: string) =>
            Effect.gen(function* () {
              if (previous.has(revisionID)) return previous.get(revisionID)
              const built = yield* store.revision(job.designID, revisionID).pipe(
                Effect.flatMap(directory),
                Effect.catchTag("Design.Error", (error) => {
                  findings.push(`Revision ${revisionID} cannot be rendered for the before capture: ${error.message}`)
                  return Effect.succeed(undefined)
                }),
              )
              previous.set(revisionID, built)
              return built
            })
          const values = (params: Design.ParamValues | undefined, controls: Design.Info["controls"]) =>
            Object.fromEntries(
              (controls ?? []).map((component) => [
                component.id,
                {
                  ...Object.fromEntries(component.fields.map((field) => [field.id, field.default])),
                  ...params?.[component.id],
                },
              ]),
            )
          /** Opens a revision in the note's variant, parameters and screen, as the reviewer saw it. */
          const prepare = (
            source: string,
            snapshot: Design.Info,
            note: { variant?: string; params?: Design.ParamValues; screen?: string },
          ) =>
            io(async () => {
              runtimeErrors.length = 0
              await page.goto(`http://design.local/${snapshot.engine === "html" ? snapshot.entry : "index.html"}`, {
                waitUntil: "load",
              })
              await page.evaluate(() => document.fonts.ready.then(() => undefined))
              if (note.variant)
                await page.evaluate((id) => {
                  document.querySelectorAll<HTMLElement>("[data-design-variant]").forEach((element) => {
                    if (element.dataset.designVariant !== id) element.style.setProperty("display", "none", "important")
                  })
                }, note.variant)
              if (note.params && Object.keys(note.params).length)
                await page.evaluate(
                  (detail) => {
                    window.dispatchEvent(new CustomEvent("design:params", { detail: { values: detail, reset: true } }))
                  },
                  values(note.params, snapshot.controls),
                )
              if (note.screen) {
                const wanted = { screen: note.screen, ...(note.variant ? { variant: note.variant } : {}) }
                await page.waitForFunction(listsScreen, wanted, { timeout: 2000 }).catch(() => undefined)
                if (!(await page.evaluate(openScreen, wanted))) return `screen ${note.screen} does not exist`
              }
              return undefined
            })
          /** A focused capture of the located element with its surroundings, clamped to one viewport. */
          const capture = (file: string, found: { rect: Rect; container: Rect }) =>
            io(async () => {
              const pad = 24
              const width = await page.evaluate(() => document.documentElement.scrollWidth)
              const height = await page.evaluate(() => document.documentElement.scrollHeight)
              const x = Math.max(0, Math.min(found.rect.x, found.container.x) - pad)
              const y = Math.max(0, Math.min(found.rect.y, found.container.y) - pad)
              const clip = {
                x,
                y,
                width: Math.max(1, Math.min(Math.max(found.rect.width, found.container.width) + 2 * pad, width - x)),
                height: Math.max(
                  1,
                  Math.min(Math.max(found.rect.height, found.container.height) + 2 * pad, 900, height - y),
                ),
              }
              await DesignFiles.atomic(file, await page.screenshot({ fullPage: true, clip, animations: "disabled" }))
            })
          yield* io(() => page.setViewportSize({ width: WIDTH, height: 900 }))
          for (const [position, note] of notes.slice(0, LIMIT).entries()) {
            const item = note.item
            const variant = item.params?.variant ?? /^variant:([a-zA-Z0-9_-]{1,64}) /.exec(item.target)?.[1]
            const where = { variant, params: item.params?.values, screen: item.params?.screen }
            const locate = { target: item.target, xpath: item.xpath ?? "", variant: variant ?? "" }
            const result: Draft = {
              feedback: note.feedback,
              index: note.index,
              label: DesignRounds.label(note),
              found: false,
              blocking: false,
              findings: [],
              scenarios: [],
              reason: "",
            }
            const base = path.join(path.dirname(output), `${job.id}-${position}`)
            // Before: the revision the note was taken on, so the reviewer sees what changed.
            const origin = item.revision ?? roundInfo.revision
            const source = origin === revision.id ? undefined : yield* before(origin)
            if (source) {
              yield* serve(source)
              const snapshot = (yield* store.revision(job.designID, origin)).document
              const problem = yield* prepare(source, snapshot, where)
              const located = problem ? undefined : yield* io(() => page.evaluate(locateNote, locate))
              if (located?.found) {
                yield* capture(`${base}-before.png`, located)
                result.before = `${base}-before.png`
              }
            }
            // After: the revision under verification.
            yield* serve(root)
            const problem = yield* prepare(root, revision.document, where)
            if (problem) result.findings.push(problem)
            const located: Located = problem
              ? { found: false, how: problem }
              : yield* io(() => page.evaluate(locateNote, locate))
            if (located.found) {
              result.found = true
              yield* capture(`${base}-after.png`, located)
              result.after = `${base}-after.png`
              const checks = yield* io(() => page.evaluate(DesignQuality.inspect))
              const layout = yield* io(() =>
                page.evaluate(
                  scopedLayout,
                  checks.map((check) => check.selector),
                ),
              )
              result.findings.push(...layout.findings)
              for (const check of checks.filter((check) => layout.inside.includes(check.selector)))
                result.findings.push(
                  `${check.severity} · ${check.rule} · ${check.selector}: ${check.evidence} Fix: ${check.fix}`,
                )
              if (checks.some((check) => layout.inside.includes(check.selector) && check.severity === "error"))
                result.blocking = true
              const accessibility = yield* io(() =>
                new AxeBuilder({ page })
                  .include('[data-redcode-verify="container"], [data-redcode-verify="target"]')
                  .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
                  .analyze(),
              )
              for (const violation of accessibility.violations) {
                result.findings.push(`error · ${violation.id}: ${violation.help} (${violation.nodes.length} elements)`)
                result.blocking = true
              }
              if (runtimeErrors.length) {
                result.findings.push(...runtimeErrors.map((error) => `error · script error: ${error}`))
                result.blocking = true
              }
              // Scenarios on the note's screen and variant exercise the states the element takes part in.
              const relevant = revision.document.scenarios
                .filter(
                  (scenario) =>
                    !scenario.notApplicable &&
                    (!scenario.variant || scenario.variant === variant) &&
                    (scenario.screen ?? "") === (where.screen ?? ""),
                )
                .slice(0, 2)
              for (const scenario of relevant) {
                yield* prepare(root, revision.document, { variant, params: scenario.params, screen: scenario.screen })
                const scope = variant ? page.locator(`[data-design-variant="${variant}"]`) : page.locator("body")
                const target = (selector: string) => scope.locator(selector).or(scope.and(page.locator(selector)))
                const outcome = yield* io(async () => {
                  for (const action of scenario.actions) {
                    if (action.action === "click") await target(action.selector).click({ timeout: 3000 })
                    if (action.action === "fill")
                      await target(action.selector).fill(action.value ?? "", { timeout: 3000 })
                    if (action.action === "press")
                      await target(action.selector).press(action.value ?? "Enter", { timeout: 3000 })
                  }
                  await target(scenario.selector).waitFor({ state: "visible", timeout: 3000 })
                  return (await target(scenario.selector).getAttribute("data-state")) === scenario.state
                    ? "exercised"
                    : "state does not match"
                }).pipe(Effect.catchTag("Design.Error", (error) => Effect.succeed(error.message)))
                result.scenarios.push(`${scenario.name}: ${outcome}`)
                if (outcome !== "exercised") result.findings.push(`review · scenario ${scenario.name}: ${outcome}`)
              }
            } else {
              result.blocking = true
            }
            const blocking = result.findings.filter((finding) => finding.startsWith("error ·"))
            const advisory = result.findings.length - blocking.length
            result.reason = !result.found
              ? `element not found in ${revision.id} (${located.how}; looked up by data-design-id, selector and XPath)`
              : blocking.length
                ? `found; ${blocking.length} blocking finding${blocking.length === 1 ? "" : "s"}: ${blocking[0].replace(/^error · /, "")}`
                : advisory
                  ? `found; ${advisory} advisory finding${advisory === 1 ? "" : "s"}`
                  : `found; no findings${result.scenarios.length ? `; ${result.scenarios.length} scenario${result.scenarios.length === 1 ? "" : "s"} exercised` : ""}`
            results.push(result)
            yield* progress((position + 1) / Math.min(notes.length, LIMIT))
          }
          report.verify = { revision: revision.id, round, width: WIDTH, notes: results, findings }
          const image = (file: string | undefined, alt: string) =>
            file
              ? Bun.file(file)
                  .bytes()
                  .then(
                    (bytes) =>
                      `<figure><figcaption>${alt}</figcaption><img style="max-width:100%" alt="${alt}" src="data:image/png;base64,${Buffer.from(bytes).toString("base64")}"></figure>`,
                  )
              : Promise.resolve(`<p>${alt}: no capture</p>`)
          const sections = yield* io(() =>
            Promise.all(
              results.map(
                async (item) =>
                  `<section id="note-${item.index}-${escape(item.feedback)}"><h2>${item.index}. ${escape(item.label)} — ${escape(item.reason)}</h2><p>Note: ${escape(notes.find((note) => note.feedback === item.feedback && note.index === item.index)?.item.text ?? "")}</p>${await image(item.before, "Before")}${await image(item.after, "After")}<h3>Findings</h3><ul>${item.findings.map((finding) => `<li>${escape(finding)}</li>`).join("") || "<li>None</li>"}</ul><h3>Scenarios</h3><ul>${item.scenarios.map((line) => `<li>${escape(line)}</li>`).join("") || "<li>None on this screen</li>"}</ul></section>`,
              ),
            ),
          )
          yield* io(() =>
            DesignFiles.atomic(
              output,
              `<!doctype html><meta charset="utf-8"><title>Design verify</title><h1>${escape(revision.document.name)}</h1><p>Round ${round} verified on revision ${escape(revision.id)} at ${WIDTH}px. Captures are evidence for the agent's per-note statuses, not approval.</p>${findings.length ? `<ul>${findings.map((finding) => `<li>${escape(finding)}</li>`).join("")}</ul>` : ""}${sections.join("\n")}`,
            ),
          )
        }

        if (job.input.format === "audit") {
          const findings: string[] = []
          const evidence: string[] = []
          const checks: Design.AuditCheck[] = []
          const captures: Design.AuditCapture[] = []
          const runtimeErrors: string[] = []
          /** "variant screen" keys: screens the prototype declares and screens an audit view showed. */
          const declared = new Set<string>()
          const visited = new Set<string>()
          page.on("pageerror", (error) => runtimeErrors.push(error.message))
          const screensMarked = yield* io(() => DesignQuality.mentionsScreens(root))
          /** Records the screens a view shows: the variant's own and the page-level ones. */
          const visit = (variant: string | undefined) =>
            Effect.gen(function* () {
              const current = yield* io(() => page.evaluate(currentScreens))
              for (const scope of new Set([variant ?? "", ""]))
                if (current[scope]) visited.add(`${scope} ${current[scope]}`)
            })
          const variants = yield* io(() =>
            page
              .locator("[data-design-variant]")
              .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-design-variant") ?? "")),
          )
          const valid = [...new Set(variants.filter((id) => /^[a-zA-Z0-9_-]{1,64}$/.test(id)))]
          if (valid.length !== variants.length)
            findings.push("Variant roots must have unique, valid data-design-variant IDs.")
          if (yield* io(() => page.locator("[data-design-variant] [data-design-variant]").count()))
            findings.push("Variant roots are nested; separate them before claiming each direction was inspected.")
          if (valid.length > 6)
            findings.push("Only the first six variants were inspected. Review the remaining directions separately.")
          const { AxeBuilder } = yield* io((signal) => DesignRuntime.load("@axe-core/playwright", signal))
          const reset = (variant: string | undefined) =>
            io(async () => {
              runtimeErrors.length = 0
              await page.goto(`http://design.local/${entry}`, { waitUntil: "load" })
              await page.evaluate(() => document.fonts.ready.then(() => undefined))
              if (variant)
                await page.evaluate((id) => {
                  document.querySelectorAll<HTMLElement>("[data-design-variant]").forEach((element) => {
                    if (element.dataset.designVariant !== id) element.style.setProperty("display", "none", "important")
                  })
                }, variant)
            })
          const inspect = Effect.fn("DesignRenderer.inspect")(function* (
            width: number,
            variant?: string,
            scenario?: string,
          ) {
            const label = `${width}px${variant ? ` · ${variant}` : ""}${scenario ? ` · ${scenario}` : " · initial"}`
            if (variant && !(yield* io(() => page.locator(`[data-design-variant="${variant}"]`).first().isVisible())))
              findings.push(`${label}: variant root is hidden; this direction remains unverified`)
            checks.push(
              ...(yield* io(() => page.evaluate(DesignQuality.inspect))).map((check) => ({
                ...check,
                width,
                variant,
                scenario,
              })),
            )
            const layout = yield* io(() =>
              page.evaluate(() => ({
                overflow: document.documentElement.scrollWidth > innerWidth + 1,
                height: document.documentElement.scrollHeight,
                controls: [
                  ...document.querySelectorAll<HTMLElement>(
                    "button,a[href],input:not([type=hidden]),select,textarea,[tabindex]",
                  ),
                ].some((element) => element.getBoundingClientRect().height > 0),
              })),
            )
            if (layout.overflow) findings.push(`${label}: horizontal overflow`)
            findings.push(...runtimeErrors.map((error) => `${label}: script error: ${error}`))
            const accessibility = yield* io(() =>
              new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze(),
            )
            for (const violation of accessibility.violations) {
              findings.push(`${label} · ${violation.id}: ${violation.help} (${violation.nodes.length} elements)`)
              checks.push(
                ...violation.nodes.slice(0, 8).map((node) => ({
                  rule: violation.id,
                  severity: "error" as const,
                  selector: node.target.join(" "),
                  evidence: node.failureSummary ?? violation.help,
                  fix: violation.helpUrl,
                  width,
                  variant,
                  scenario,
                })),
              )
            }
            if (layout.controls) {
              yield* io(() => page.keyboard.press("Tab"))
              const focused = yield* io(() =>
                page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null),
              )
              if (!focused) findings.push(`${label}: keyboard Tab did not reach an interactive element`)
            }
            const fullPage = layout.height <= 12000
            if (!fullPage)
              findings.push(
                `${label}: page exceeds 12000px; capture covers only the current viewport. Inspect remaining content before a visual verdict.`,
              )
            const file = path.join(path.dirname(output), `${job.id}-${captures.length}.png`)
            yield* io(async () => DesignFiles.atomic(file, await page.screenshot({ fullPage, animations: "disabled" })))
            captures.push({ file, width, variant, scenario, fullPage })
          })
          for (const width of [390, 768, 1440]) {
            yield* io(() => page.setViewportSize({ width, height: 900 }))
            for (const variant of valid.length ? valid.slice(0, 6) : [undefined]) {
              if (captures.length >= 36) continue
              yield* reset(variant)
              if (width === 390 && screensMarked) {
                // A framework may mount its screens after load; give it a moment before reading them.
                yield* io(() => page.waitForFunction(anyScreen, undefined, { timeout: 2000 }).catch(() => undefined))
                // Passed as the function itself so it runs on the page's own document, without eval.
                const problems = yield* io(() => page.evaluate(DesignQuality.screenProblems as () => string[]))
                for (const problem of problems)
                  if (!findings.includes(`Screens: ${problem}`)) findings.push(`Screens: ${problem}`)
                for (const screen of yield* io(() => page.evaluate(declaredScreens)))
                  if (!variant || screen.variant === variant || screen.variant === "")
                    declared.add(`${screen.variant} ${screen.id}`)
              }
              if (screensMarked) yield* visit(variant)
              yield* inspect(width, variant)
              for (const scenario of revision.document.scenarios) {
                if (
                  scenario.notApplicable ||
                  (scenario.variant && scenario.variant !== variant) ||
                  captures.length >= 36
                )
                  continue
                yield* reset(variant)
                let scope = variant ? page.locator(`[data-design-variant="${variant}"]`) : page.locator("body")
                // A scenario may observe state on the variant root itself.
                const target = (selector: string) => scope.locator(selector).or(scope.and(page.locator(selector)))
                const result = yield* io(async () => {
                  if (scenario?.params)
                    await page.evaluate(
                      (values) => {
                        window.dispatchEvent(new CustomEvent("design:params", { detail: { values, reset: true } }))
                      },
                      Object.fromEntries(
                        (revision.document.controls ?? []).map((component) => [
                          component.id,
                          {
                            ...Object.fromEntries(component.fields.map((field) => [field.id, field.default])),
                            ...scenario.params?.[component.id],
                          },
                        ]),
                      ),
                    )
                  if (scenario.screen) {
                    const wanted = { screen: scenario.screen, ...(variant ? { variant } : {}) }
                    await page.waitForFunction(listsScreen, wanted, { timeout: 2000 }).catch(() => undefined)
                    if (!(await page.evaluate(openScreen, wanted)))
                      return `screen ${scenario.screen} does not exist${variant ? " in this variant or on the page" : ""}`
                    // A page-level screen lives outside the variant root, so its selectors resolve on the page.
                    const own = await page.evaluate(listsScreen, { screen: scenario.screen, variant: variant ?? "" })
                    if (
                      variant &&
                      own &&
                      !(await page.evaluate(declaredScreens)).some(
                        (item) => item.id === scenario.screen && item.variant === variant,
                      )
                    )
                      scope = page.locator("body")
                  }
                  for (const action of scenario.actions) {
                    if (action.action === "click") await target(action.selector).click({ timeout: 3000 })
                    if (action.action === "fill")
                      await target(action.selector).fill(action.value ?? "", { timeout: 3000 })
                    if (action.action === "press")
                      await target(action.selector).press(action.value ?? "Enter", { timeout: 3000 })
                  }
                  await target(scenario.selector).waitFor({ state: "visible", timeout: 3000 })
                  return (await target(scenario.selector).getAttribute("data-state")) === scenario.state
                }).pipe(Effect.catchTag("Design.Error", (error) => Effect.succeed(error.message)))
                if (screensMarked) yield* visit(variant)
                const label = `${width}px${variant ? ` · ${variant}` : ""} · ${scenario.name}`
                if (result !== true)
                  findings.push(`${label}: ${typeof result === "string" ? result : "state does not match"}`)
                if (result === true) evidence.push(`${label}: exercised`)
                yield* inspect(width, variant, scenario.id)
              }
            }
            yield* progress(([390, 768, 1440].indexOf(width) + 1) / 3)
          }
          if (captures.length >= 36)
            findings.push(
              "Capture budget reached (36 views). Check the capture manifest and inspect any missing variants or states separately.",
            )
          if (!evidence.length)
            findings.push("No scenarios have been exercised; interaction behavior remains unverified.")
          const unvisited = [...declared].filter((key) => !visited.has(key))
          if (unvisited.length)
            findings.push(
              `Screens never rendered by this audit: ${unvisited.map((key) => key.trim().replace(" ", "/")).join(", ")}. ${
                captures.length >= 36
                  ? "The capture budget was reached, so later scenarios were skipped; audit those screens separately."
                  : "Add a scenario with screen set to each one so its layout and states are inspected."
              }`,
            )
          for (const scenario of revision.document.scenarios.filter(
            (scenario) => scenario.variant && !valid.includes(scenario.variant) && !scenario.notApplicable,
          ))
            findings.push(`Scenario ${scenario.name}: variant ${scenario.variant} was not rendered.`)
          findings.push(
            ...checks
              .filter((check) => check.severity === "error" && check.rule === "broken-image")
              .map((check) => `${check.width}px · ${check.selector}: ${check.evidence}`),
          )
          report.audit = {
            revision: revision.id,
            findings,
            scenarios: evidence,
            widths: [...new Set(captures.map((capture) => capture.width))],
            checks,
            captures,
          }
          const escape = (text: string) =>
            text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
          const screenshots = yield* io(() =>
            Promise.all(
              captures.map(
                async (capture) =>
                  `<h2>${capture.width}px · ${escape(capture.variant ?? "Page")} · ${escape(capture.scenario ?? "Initial")}</h2><p>${capture.fullPage ? "Full page" : "Viewport only"}</p><img style="max-width:100%" alt="Rendered review evidence" src="data:image/png;base64,${Buffer.from(await Bun.file(capture.file).bytes()).toString("base64")}">`,
              ),
            ),
          )
          yield* io(() =>
            DesignFiles.atomic(
              output,
              `<!doctype html><meta charset="utf-8"><title>Design audit</title><h1>${escape(revision.document.name)}</h1><p>Revision ${escape(revision.id)}. Automated findings require visual and task review; advisory signals are not proof of AI authorship.</p><h2>Exercised scenarios</h2><ul>${evidence.map((item) => `<li>${escape(item)}</li>`).join("")}</ul><h2>Findings</h2><ul>${findings.map((finding) => `<li>${escape(finding)}</li>`).join("")}</ul><h2>Quality checks</h2><ul>${checks.map((check) => `<li>${escape(`${check.severity} · ${check.width}px · ${check.variant ?? "Page"} · ${check.scenario ?? "Initial"} · ${check.rule} · ${check.selector}: ${check.evidence} Fix: ${check.fix}`)}</li>`).join("")}</ul>${screenshots.join("")}`,
            ),
          )
        }
      }),
    )
    yield* store.putJob({
      ...job,
      status: "completed",
      started,
      finished: Date.now(),
      progress: 1,
      result: output,
      ...report,
    })
  }, lock.withPermits(1))

  const start = Effect.fn("DesignRenderer.start")(function* (id: Design.ID, input: Design.Render) {
    yield* store.revision(id, input.revision)
    if (input.format === "verify") {
      // Fail now, in the tool result, rather than in a job the agent has to poll for.
      const document = yield* store.get(id)
      const round = input.round ?? DesignRounds.latest(document)?.number
      if (round === undefined)
        return yield* new Design.Error({
          code: "invalid",
          message: "No feedback round to verify yet; notes arrive from the review page",
        })
      if (!DesignRounds.notes(document, round).length)
        return yield* new Design.Error({ code: "invalid", message: `Round ${round} has no notes to verify` })
    }
    const candidate =
      input.format === "compare" ? yield* store.implementation(id, input.implementation ?? "dist") : undefined
    if (candidate && candidate.parent !== input.revision)
      return yield* new Design.Error({ code: "conflict", message: "Compare against the approved revision" })
    const job: Design.Job = {
      id: `render_${crypto.randomUUID()}`,
      designID: id,
      input: { ...input, candidate: candidate?.id },
      status: "queued",
      progress: 0,
      result: null,
      error: null,
      created: Date.now(),
    }
    yield* store.putJob(job)
    const fiber = yield* render(job).pipe(
      // A verify renders two revisions per note; it gets room for a round of two dozen notes.
      Effect.timeout(input.format === "verify" ? "300 seconds" : "120 seconds"),
      Effect.catchCause((cause) =>
        store.putJob({
          ...job,
          status: Cause.hasInterrupts(cause) ? "interrupted" : "failed",
          error: Cause.pretty(cause),
          finished: Date.now(),
        }),
      ),
      Effect.asVoid,
      Effect.ensuring(Effect.sync(() => active.delete(job.id))),
      Effect.forkIn(scope),
    )
    active.set(job.id, fiber)
    return job
  })

  const cancel = Effect.fn("DesignRenderer.cancel")(function* (id: Design.ID, jobID: string) {
    const job = (yield* store.jobs(id)).find((job) => job.id === jobID)
    if (!job) return yield* new Design.Error({ code: "not-found", message: "Render job not found" })
    const fiber = active.get(jobID)
    if (fiber) yield* Fiber.interrupt(fiber)
    const current = (yield* store.jobs(id)).find((item) => item.id === jobID)!
    if (current.status === "completed" || current.status === "failed" || current.status === "cancelled") return current
    yield* io(() =>
      rm(path.join(store.storage, id, "exports", `${jobID}.${job.input.format === "gif" ? "gif" : "html"}`), {
        force: true,
      }),
    )
    return yield* store.putJob({ ...job, status: "cancelled", finished: Date.now() })
  })
  const jobs = Effect.fn("DesignRenderer.jobs")(function* (id: Design.ID) {
    return yield* Effect.forEach(yield* store.jobs(id), (job) =>
      (job.status === "running" || job.status === "queued") && !active.has(job.id)
        ? store.putJob({ ...job, status: "interrupted", finished: Date.now() })
        : Effect.succeed(job),
    )
  })
  return { start, cancel, jobs, directory }
})

export type Interface = Effect.Success<typeof make>
export class Service extends Context.Service<Service, Interface>()("@redcode/DesignRenderer") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [DesignStore.node, AppProcess.node],
})
