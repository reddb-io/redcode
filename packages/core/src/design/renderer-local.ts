/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="dom.asynciterable" />
/// <reference path="./gifenc.d.ts" />
export * as DesignRendererLocal from "./renderer-local.js"

import path from "node:path"
import { createRequire } from "node:module"
import { readdir, rm } from "node:fs/promises"
import { Cause, Effect, Exit, Fiber, Layer, Scope, Semaphore } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Design } from "@opencode/schema/design"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { AppProcess } from "@opencode/util/process"
import { DesignStore } from "./store.js"
import { DesignRenderer } from "./renderer.js"
import { DesignBuild } from "./build.js"
import { DesignFiles } from "./files.js"
import { DesignExport } from "./export.js"
import { DesignAssets } from "./assets.js"
import { DesignRaster } from "./raster.js"
import { DesignRuntime } from "./runtime.js"
import { DesignQuality } from "./quality.js"
import { DesignSignature } from "./signature.js"
import { DesignRounds } from "./rounds.js"
import { DesignViewports } from "./viewports.js"
import { DesignGate } from "./gate.js"
import { DesignLocate } from "./locate.js"
import { DesignVerify } from "./verify.js"
import { screens } from "./ui/screens.js"
import { deck, slides } from "./ui/slides.js"
import { device } from "./ui/devices.js"
import type { Viewport } from "./ui/viewports.js"

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
/**
 * Sets a phone's safe-area insets on the page root before the prototype's scripts run, waiting for the
 * root element when the document has none yet.
 */
const safeArea = (inset: { readonly top: number; readonly bottom: number }) => {
  const apply = () => {
    const root = document.documentElement
    if (!root) return false
    root.style.setProperty("--safe-area-top", `${inset.top}px`)
    root.style.setProperty("--safe-area-bottom", `${inset.bottom}px`)
    return true
  }
  if (apply()) return
  new MutationObserver((_, observer) => {
    if (apply()) observer.disconnect()
  }).observe(document, { childList: true })
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
 * Locates a review note's element in the rendered page (see DesignLocate.resolve for the order), marks
 * the element and its container so the checks that follow can address them, and scrolls the element
 * into view so a focused capture shows it. Runs inside the page, given the resolver's source.
 */
type Rect = { x: number; y: number; width: number; height: number }
type Located =
  | { found: false; how: string }
  | { found: true; how: string; rect: Rect; container: Rect; text: string; markup: string }
const locateNote = (
  input: { target: string; xpath: string; variant: string },
  resolve: typeof DesignLocate.resolve,
  facts: typeof DesignLocate.facts,
): Located => {
  document.querySelectorAll("[data-redcode-verify]").forEach((node) => node.removeAttribute("data-redcode-verify"))
  const hit = resolve(document, input)
  if (!hit.found) return hit
  const element = hit.node
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return { found: false, how: "not found" }
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
  // The computed properties a visual edit of the element usually touches, for the before/after delta.
  const style = getComputedStyle(element)
  const read = facts(
    element,
    [
      "color",
      "background-color",
      "background-image",
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "line-height",
      "letter-spacing",
      "text-align",
      "text-transform",
      "text-decoration-line",
      "padding",
      "margin",
      "border",
      "border-radius",
      "box-shadow",
      "outline",
      "opacity",
      "display",
      "visibility",
      "flex-direction",
      "justify-content",
      "align-items",
      "gap",
      "grid-template-columns",
      "width",
      "height",
    ]
      .map((name) => style.getPropertyValue(name))
      .join(";"),
  )
  return {
    found: true,
    how: hit.how,
    rect: { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height },
    container: { x: around.x + scrollX, y: around.y + scrollY, width: around.width, height: around.height },
    text: read.text,
    markup: read.markup,
  }
}

/**
 * Whether a scenario acts on or observes the element locateNote marked: one of its selectors matches
 * the element, an element inside it, or an ancestor within the element's container (a button around
 * a noted icon), but not a page-wide ancestor, which would make every scenario touch every note.
 * Scoped to the note's variant like the scenario's own lookups. Runs inside the page, self-contained.
 */
const touchesNote = (input: { selectors: string[]; variant: string }) => {
  const element = document.querySelector('[data-redcode-verify="target"]')
  if (!element) return false
  const container = document.querySelector('[data-redcode-verify="container"]') ?? element
  const root = input.variant ? document.querySelector(`[data-design-variant="${input.variant}"]`) : null
  const scope: ParentNode = root ?? document
  return input.selectors.some((selector) => {
    try {
      return [...scope.querySelectorAll(selector), ...(root?.matches(selector) ? [root] : [])].some(
        (node) => element.contains(node) || (node.contains(element) && container.contains(node)),
      )
    } catch {
      // An invalid selector fails the scenario itself; it touches nothing.
      return false
    }
  })
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
 * the doctype, so it never lands before the doctype or inside a <header>. A presentation also gets the
 * slide runtime, ahead of the screens, so its slides are screens from the first announcement.
 */
export function injectScreens(html: string, target?: Design.Surface) {
  const tag = `${target === "presentation" ? `<script>(${slides.toString()})(${deck.toString()})</script>` : ""}<script>(${screens.toString()})()</script>`
  for (const pattern of [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
    const match = pattern.exec(html)
    if (match) return html.slice(0, match.index + match[0].length) + tag + html.slice(match.index + match[0].length)
  }
  return tag + html
}

/** Prefix of a job failure caused by the local browser being unavailable. */
export const UNAVAILABLE = "Browser unavailable:"

/**
 * A job that cannot get a browser (Playwright or Chromium missing, an offline install, a launch
 * failure) fails the same way on every retry until that is fixed, so the message says so and, for a
 * verify, names the outcome that records the round instead of looping on it.
 */
export const unavailable = (job: Pick<Design.Job, "id" | "input">) => (error: Design.Error) =>
  error.message.startsWith(UNAVAILABLE)
    ? error
    : new Design.Error({
        code: "unavailable",
        message: `${UNAVAILABLE} ${error.message.trim()} Retrying fails the same way until the browser can be installed or launched, so do not retry in a loop. ${
          job.input.format === "verify"
            ? `Record each open note of the round partial (or unresolved) with the reason "verification unavailable: <cause>" and evidence {"job":"${job.id}"}, then tell the reviewer.`
            : "Tell the user what failed instead of retrying."
        }`,
      })

const io = <A>(run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => new Design.Error({ code: "unavailable", message: DesignBuild.reason(error) }),
  })

export const make = Effect.gen(function* () {
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

  /** Loads Playwright and installs Chromium on first use, which can take minutes. */
  const setup = Effect.gen(function* () {
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
    return chromium
  })

  const browser = Effect.fn("DesignRenderer.browser")(function* (chromium: Effect.Success<typeof setup>) {
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

  const render = Effect.fn("DesignRenderer.render")(function* (
    sessionID: Design.Info["sessionID"],
    job: Design.Job,
    budget: number,
  ) {
    const report: { audit?: Design.Audit; verify?: Design.Verify } = {}
    const started = Date.now()
    yield* store.putJob(sessionID, { ...job, status: "running", started, phase: "preparing" })
    const revision = yield* store.revision(sessionID, job.designID, job.input.revision)
    const design = yield* store.configured(revision.document.sessionID)
    // The layout audit covers only the configured viewport classes (design.viewports), the ones the gate requires.
    const sizes =
      job.input.format === "audit"
        ? DesignGate.viewports(revision.document, design, design?.viewports)
        : DesignViewports.of(revision.document, design)
    // The build and first-use browser setup can take minutes, so the render budget starts after them;
    // a bound of their own keeps a stalled install from holding the renderer.
    const prepared = yield* Effect.all([directory(revision), setup.pipe(Effect.mapError(unavailable(job)))]).pipe(
      Effect.timeoutOrElse({
        duration: "10 minutes",
        orElse: () =>
          Effect.fail(
            unavailable(job)(
              new Design.Error({
                code: "unavailable",
                message:
                  "Preparing the renderer (building the revision and installing the browser) exceeded ten minutes.",
              }),
            ),
          ),
      }),
    )
    const root = prepared[0]
    yield* store.putJob(sessionID, { ...job, status: "running", started })
    const progress = (value: number) => store.putJob(sessionID, { ...job, status: "running", started, progress: value })
    const presentation = revision.document.target === "presentation"
    const output = path.join(
      store.storage,
      job.designID,
      "exports",
      `${job.id}.${Design.exportFile(job.input.format).extension}`,
    )
    yield* Effect.scoped(
      Effect.gen(function* () {
        const instance = yield* browser(prepared[1]).pipe(Effect.mapError(unavailable(job)))
        /** Script errors of the current page; the audit and verify clear it before each view they check. */
        const runtimeErrors: string[] = []
        /**
         * A page for one viewport. An app viewport is its phone: touch, mobile layout, device pixel ratio
         * and user agent, which a browser context fixes when it is created, plus the phone's safe-area
         * insets as --safe-area-top/--safe-area-bottom (CSS env() cannot be set from outside, so designs
         * pad with max(env(safe-area-inset-*, 0px), var(--safe-area-*, 0px))). Any other viewport is a
         * desktop page.
         */
        const open = Effect.fn("DesignRenderer.open")(function* (viewport: Viewport | undefined) {
          const phone = viewport?.device ? device(viewport.device) : undefined
          const context = yield* io(() =>
            instance.newContext({
              viewport: { width: viewport?.width ?? 1440, height: viewport?.height ?? 900 },
              reducedMotion: "reduce",
              ...(phone
                ? { deviceScaleFactor: phone.scale, isMobile: true, hasTouch: true, userAgent: phone.userAgent }
                : {}),
            }),
          )
          // Screens and the design helper run before the prototype's scripts, as in the review page. A
          // compare injects them only into the approved prototype, never into the implementation.
          if (job.input.format !== "compare" && presentation)
            yield* io(() => context.addInitScript({ content: `(${slides.toString()})(${deck.toString()})` }))
          if (job.input.format !== "compare")
            yield* io(() => context.addInitScript({ content: `(${screens.toString()})()` }))
          if (phone) yield* io(() => context.addInitScript(safeArea, phone.safeArea))
          const page = yield* io(() => context.newPage())
          page.on("pageerror", (error) => runtimeErrors.push(error.message))
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
              await route.fulfill({
                body: Buffer.from(await Bun.file(file).bytes()),
                contentType: Bun.file(file).type,
              })
            }),
          )
          return page
        })
        const inspected =
          job.input.format === "audit" || job.input.format === "compare" || job.input.format === "verify"
        // The page is replaced when an app job moves to the other phone; helpers read it when they run.
        // A PDF is printed from the presentation's own 1920×1080 viewport.
        let page = yield* open((inspected && sizes[0]?.device) || job.input.format === "pdf" ? sizes[0] : undefined)
        let emulated = inspected ? sizes[0]?.device : undefined
        /** Shows the page at a viewport: resized in place, or a new page when the phone changes. */
        const emulate = Effect.fn("DesignRenderer.emulate")(function* (viewport: Viewport) {
          if (viewport.device === emulated)
            return yield* io(() => page.setViewportSize({ width: viewport.width, height: viewport.height }))
          yield* io(() => page.context().close())
          page = yield* open(viewport)
          emulated = viewport.device
        })
        const entry = revision.document.engine === "html" ? revision.document.entry : "index.html"
        if (job.input.format !== "gif")
          yield* io(() => page.goto(`http://design.local/${entry}`, { waitUntil: "load" }))
        yield* io(() => page.evaluate(() => document.fonts.ready.then(() => undefined)))

        if (job.input.format === "gif") {
          if (!job.input.asset) return yield* new Design.Error({ code: "invalid", message: "Choose an SVG asset" })
          const asset = yield* store.asset(sessionID, job.designID, job.input.asset)
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
          yield* io(() => DesignFiles.atomic(output, injectScreens(html, revision.document.target)))
        }

        if (job.input.format === "pdf") {
          // Frameworks can mount their slides after load; give them a moment, as the audit does.
          yield* io(() => page.waitForFunction(anyScreen, undefined, { timeout: 2000 }).catch(() => undefined))
          // Every slide shows at once, one per 1920×1080 page (the slide runtime's print rules); notes stay hidden.
          const count = yield* io(() =>
            // With a variant, only its slides print, besides those outside any variant.
            page.evaluate((variant) => {
              window.dispatchEvent(new CustomEvent("design:print", { detail: { variant } }))
              return document.querySelectorAll(
                variant
                  ? `[data-design-variant="${variant}"] section.slide, section.slide:not([data-design-variant] *)`
                  : "section.slide",
              ).length
            }, job.input.variant ?? ""),
          )
          if (!count)
            return yield* new Design.Error({
              code: "invalid",
              message: 'The deck has no <section class="slide">; write one section per slide and publish again.',
            })
          const pdf = yield* io(() =>
            page.pdf({ width: "1920px", height: "1080px", preferCSSPageSize: true, printBackground: true }),
          )
          yield* io(() => DesignFiles.atomic(output, pdf))
        }

        if (job.input.format === "compare") {
          if (!job.input.candidate)
            return yield* new Design.Error({ code: "invalid", message: "Implementation snapshot is missing" })
          const candidate = yield* store.revision(sessionID, job.designID, job.input.candidate)
          const candidateRoot = yield* directory(candidate)
          const raster = yield* DesignRaster.make
          const report: string[] = []
          const escape = (value: string) =>
            value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
          const scenarios = revision.document.scenarios.filter((scenario) => !scenario.notApplicable)
          if (!scenarios.length)
            report.push("<p>No acceptance scenarios were supplied. These screenshots require manual review.</p>")
          for (const [index, viewport] of sizes.entries()) {
            const width = viewport.width
            const images: Buffer[] = []
            for (const source of [root, candidateRoot]) {
              // First, since a new phone page comes with only the approved prototype's route.
              yield* emulate(viewport)
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
                        ? injectScreens(bytes.toString("utf8"), revision.document.target)
                        : bytes,
                    contentType: Bun.file(file).type,
                  })
                }),
              )
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
                const screenshot = yield* io(() => page.screenshot({ animations: "disabled", scale: "css" }))
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
            yield* progress((index + 1) / sizes.length)
          }
          yield* io(() =>
            DesignFiles.atomic(
              output,
              `<!doctype html><meta charset="utf-8"><title>Approved design comparison</title><h1>${escape(revision.document.name)}</h1><p>Approved ${escape(revision.id)} · implementation ${escape(candidate.id)}</p>${report.join("\n")}`,
            ),
          )
        }

        if (job.input.format === "verify") {
          const current = yield* store.get(sessionID, job.designID)
          const round = job.input.round ?? DesignRounds.latest(current)?.number
          const roundInfo = current.rounds?.find((item) => item.number === round)
          const notes = round === undefined ? [] : DesignRounds.notes(current, round)
          if (round === undefined || !roundInfo || !notes.length)
            return yield* new Design.Error({
              code: "invalid",
              message: round === undefined ? "No feedback round to verify yet" : `Round ${round} has no notes`,
            })
          // Each note is judged at the viewport it was taken at (the widest for a note that recorded none),
          // with at most DesignVerify.WIDTHS viewports per job.
          const plan = DesignVerify.placements(notes, sizes)
          const WIDTHS = [...new Set(plan.placements.map((item) => item.viewport.width))].toSorted((a, b) => a - b)
          const WIDTH = WIDTHS.at(-1)!
          /** One note's budget; a note that exceeds it is recorded as timed out and the job goes on. */
          const NOTE_BUDGET = "45 seconds"
          const VARIANT = /^[a-zA-Z0-9_-]{1,64}$/
          const findings: string[] = DesignVerify.collapsedFindings(plan.collapsed)
          if (plan.collapsed.length) yield* Effect.logInfo("design verify collapsed viewports", { collapsed: findings })
          const raster = yield* DesignRaster.make
          type Draft = {
            -readonly [K in keyof Design.VerifyNote]: Design.VerifyNote[K] extends ReadonlyArray<string>
              ? string[]
              : Design.VerifyNote[K]
          }
          const results: Draft[] = []
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
          /** Revision documents read once per job, however many notes share a revision. */
          const snapshots = new Map<string, Design.Info>()
          const snapshot = (revisionID: string) =>
            Effect.gen(function* () {
              const cached = snapshots.get(revisionID)
              if (cached) return cached
              const loaded = (yield* store.revision(sessionID, job.designID, revisionID)).document
              snapshots.set(revisionID, loaded)
              return loaded
            })
          /** Scoped accessibility check of the marked container; only serious and critical impacts can block. */
          const audit = () =>
            io(() =>
              new AxeBuilder({ page })
                .include('[data-redcode-verify="container"], [data-redcode-verify="target"]')
                .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
                .analyze(),
            ).pipe(
              Effect.map((result) =>
                result.violations.map((violation) => ({
                  id: violation.id,
                  help: violation.help,
                  serious: violation.impact === "serious" || violation.impact === "critical",
                  nodes: violation.nodes.map((node) => `${violation.id}|${node.target.join(" ")}`),
                })),
              ),
            )
          /** The built directory of the revision a note was taken on; undefined when it cannot be rendered. */
          const previous = new Map<string, string | undefined>()
          const before = (revisionID: string) =>
            Effect.gen(function* () {
              if (previous.has(revisionID)) return previous.get(revisionID)
              const built = yield* store.revision(sessionID, job.designID, revisionID).pipe(
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
              // Crops are read by people and embedded in the report; JPEG keeps the report small.
              await DesignFiles.atomic(
                file,
                await page.screenshot({
                  type: "jpeg",
                  quality: 80,
                  fullPage: true,
                  clip,
                  animations: "disabled",
                  scale: "css",
                }),
              )
            })
          /** The element alone as a PNG for the before/after pixel comparison, bounded to what the raster worker decodes. */
          const crop = (rect: Rect) =>
            io(async () => {
              const width = await page.evaluate(() => document.documentElement.scrollWidth)
              const height = await page.evaluate(() => document.documentElement.scrollHeight)
              const x = Math.max(0, Math.floor(rect.x))
              const y = Math.max(0, Math.floor(rect.y))
              return page.screenshot({
                type: "png",
                fullPage: true,
                clip: {
                  x,
                  y,
                  width: Math.max(1, Math.min(Math.round(rect.width), 2048, width - x)),
                  height: Math.max(1, Math.min(Math.round(rect.height), 2048, height - y)),
                },
                animations: "disabled",
                scale: "css",
              })
            })
          /** Results in the round's order, whatever viewport order they were verified in. */
          const ordered = () =>
            results.toSorted(
              (a, b) =>
                notes.findIndex((note) => note.feedback === a.feedback && note.index === a.index) -
                notes.findIndex((note) => note.feedback === b.feedback && note.index === b.index),
            )
          /** Records what the job has so far, so a timeout or crash keeps every finished note. */
          const record = (done: number) =>
            store.putJob(sessionID, {
              ...job,
              status: "running",
              started,
              progress: done / notes.length,
              verify: { revision: revision.id, round, width: WIDTH, widths: WIDTHS, notes: ordered(), findings },
            })
          // Notes are verified one viewport after another, so each viewport is set up once.
          const order = plan.placements.flatMap((placement) =>
            placement.notes.map((position) => ({ position, note: notes[position], viewport: placement.viewport })),
          )
          for (const [done, { position, note, viewport }] of order.entries()) {
            if (done === 0 || viewport !== order[done - 1].viewport) yield* emulate(viewport)
            const item = note.item
            // The variant id reaches selectors; one the review frame could not have produced is ignored.
            const named = item.params?.variant ?? /^variant:([a-zA-Z0-9_-]{1,64}) /.exec(item.target)?.[1]
            const variant = named && VARIANT.test(named) ? named : undefined
            const where = { variant, params: item.params?.values, screen: item.params?.screen }
            // Serialized with the resolver, which the page cannot import.
            const locate = `(${locateNote.toString()})(${JSON.stringify({ target: item.target, xpath: item.xpath ?? "", variant: variant ?? "" })}, ${DesignLocate.resolve.toString()}, ${DesignLocate.facts.toString()})`
            const result: Draft = {
              feedback: note.feedback,
              index: note.index,
              label: DesignRounds.label(note),
              found: false,
              blocking: false,
              findings: [],
              scenarios: [],
              reason: "",
              width: viewport.width,
              ...(viewport.device ? { platform: viewport.device } : {}),
            }
            if (named && !variant)
              result.findings.push(`review · variant id ${JSON.stringify(named)} is invalid; located on the whole page`)
            const base = path.join(path.dirname(output), `${job.id}-${position}`)
            /** What the element's container already had before the fix: those findings never block the note. */
            const baseline = { nodes: new Set<string>(), errors: new Set<string>() }
            // A page-level note resolves to the whole variant root or body: its crop is clamped to 2048px,
            // so a change below the fold reads as none, and its fingerprint hashes the whole subtree with
            // its scripts and animation state, so it can read as changed on every render. Its delta is not
            // measured, and the status gate asks only for a completed verify (DesignRounds.triage).
            const whole = DesignVerify.isPage(item.target)
            /** Scenarios that verified a behavior of the note's element; see Design.VerifyNote.exercised. */
            const exercised: string[] = []
            const verifyNote = Effect.gen(function* () {
              // Before: the revision the note was taken on, so the reviewer sees what changed.
              const origin = item.revision ?? roundInfo.revision
              const source = origin === revision.id ? undefined : yield* before(origin)
              /** The element on the revision the note was taken on, when that revision rendered. */
              const prior: { rendered: boolean; facts?: DesignVerify.Facts; png?: Buffer } = { rendered: false }
              if (source) {
                yield* serve(source)
                const problem = yield* prepare(source, yield* snapshot(origin), where)
                const located = problem ? undefined : yield* io(() => page.evaluate<Located>(locate))
                prior.rendered = true
                if (located?.found) {
                  prior.facts = located
                  if (!whole) prior.png = yield* crop(located.rect)
                  yield* capture(`${base}-before.jpg`, located)
                  result.before = `${base}-before.jpg`
                  for (const violation of yield* audit()) for (const node of violation.nodes) baseline.nodes.add(node)
                  for (const error of runtimeErrors) baseline.errors.add(error)
                }
              }
              // After: the revision under verification.
              yield* serve(root)
              const problem = yield* prepare(root, revision.document, where)
              if (problem) result.findings.push(problem)
              const located: Located = problem
                ? { found: false, how: problem }
                : yield* io(() => page.evaluate<Located>(locate))
              if (located.found) {
                result.found = true
                // Read before the scenarios below change the element's state. Same-size crops compare pixel
                // by pixel; a resized element is already a change, and a failed comparison measures nothing.
                const earlier = prior.png
                const pixels = earlier
                  ? yield* crop(located.rect).pipe(
                      Effect.flatMap((png) => raster.compare(earlier, png)),
                      Effect.catchTag("Design.Error", () => Effect.succeed(undefined)),
                    )
                  : undefined
                const change = whole
                  ? undefined
                  : origin === revision.id
                    ? DesignVerify.delta(located, located)
                    : prior.rendered
                      ? DesignVerify.delta(prior.facts, located, pixels)
                      : undefined
                if (change) result.delta = change
                yield* capture(`${base}-after.jpg`, located)
                result.after = `${base}-after.jpg`
                const checks = yield* io(() =>
                  page.evaluate(DesignQuality.inspect, DesignQuality.minimumControl(emulated)),
                )
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
                // Only a new serious or critical violation blocks; what the container already had is advisory.
                for (const violation of yield* audit()) {
                  const fresh = violation.nodes.filter((node) => !baseline.nodes.has(node))
                  const line = `${violation.id}: ${violation.help} (${violation.nodes.length} elements)`
                  if (!fresh.length) result.findings.push(`review · pre-existing: ${line}`)
                  else if (violation.serious) {
                    result.findings.push(`error · ${line}`)
                    result.blocking = true
                  } else result.findings.push(`review · ${line}`)
                }
                for (const error of new Set(runtimeErrors)) {
                  if (baseline.errors.has(error)) result.findings.push(`review · pre-existing script error: ${error}`)
                  else {
                    result.findings.push(`error · script error: ${error}`)
                    result.blocking = true
                  }
                }
                // Scenarios on the note's screen and variant exercise the states the element takes part in.
                // One added or changed since the note's revision is how the agent verifies a behavior a
                // capture cannot show, so those run first.
                const known = (prior.rendered ? yield* snapshot(origin) : revision.document).scenarios.map((scenario) =>
                  JSON.stringify(scenario),
                )
                const fresh = (scenario: Design.Scenario) => !known.includes(JSON.stringify(scenario))
                const relevant = revision.document.scenarios
                  .filter(
                    (scenario) =>
                      !scenario.notApplicable &&
                      (!scenario.variant || scenario.variant === variant) &&
                      (scenario.screen ?? "") === (where.screen ?? ""),
                  )
                  .toSorted((a, b) => Number(fresh(b)) - Number(fresh(a)))
                  .slice(0, 2)
                for (const scenario of relevant) {
                  yield* prepare(root, revision.document, { variant, params: scenario.params, screen: scenario.screen })
                  // Read before the actions run, which may replace the element.
                  const touched =
                    fresh(scenario) &&
                    (yield* io(() =>
                      page.evaluate<boolean>(
                        `(${locate}).found && (${touchesNote.toString()})(${JSON.stringify({ selectors: [scenario.selector, ...scenario.actions.map((action) => action.selector)], variant: variant ?? "" })})`,
                      ),
                    ))
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
                  if (outcome === "exercised" && touched) exercised.push(scenario.name)
                }
              } else {
                result.blocking = true
              }
            })
            const outcome = yield* verifyNote.pipe(Effect.timeout(NOTE_BUDGET), Effect.exit)
            if (Exit.isFailure(outcome)) {
              // A note that ran out of time or hit a renderer error keeps what it got; the job goes on.
              const cause = Cause.squash(outcome.cause)
              const timedOut =
                Cause.hasInterrupts(outcome.cause) ||
                (typeof cause === "object" && cause !== null && (cause as { _tag?: string })._tag === "TimeoutError")
              result.found = false
              result.blocking = true
              result.findings.push(
                timedOut
                  ? `error · timed out after ${NOTE_BUDGET}; run the verify again for this round`
                  : `error · ${cause instanceof Error ? cause.message : String(cause)}`,
              )
            }
            const blocking = result.findings.filter((finding) => finding.startsWith("error ·"))
            const advisory = result.findings.length - blocking.length
            result.reason = !result.found
              ? Exit.isFailure(outcome)
                ? blocking[0].replace(/^error · /, "")
                : `element not found in ${revision.id} (${result.findings.find((finding) => !finding.startsWith("error ·") && !finding.startsWith("review ·")) ?? "not found"}; looked up by selector, data-design-id and XPath)`
              : blocking.length
                ? `found; ${blocking.length} blocking finding${blocking.length === 1 ? "" : "s"}: ${blocking[0].replace(/^error · /, "")}`
                : advisory
                  ? `found; ${advisory} advisory finding${advisory === 1 ? "" : "s"}`
                  : `found; no findings${result.scenarios.length ? `; ${result.scenarios.length} scenario${result.scenarios.length === 1 ? "" : "s"} exercised` : ""}`
            if (exercised.length) result.exercised = exercised
            result.reason = [
              result.reason,
              ...DesignVerify.remarks({ item, viewport, found: result.found, delta: result.delta, exercised }),
            ].join("; ")
            results.push(result)
            yield* record(done + 1)
          }
          report.verify = { revision: revision.id, round, width: WIDTH, widths: WIDTHS, notes: ordered(), findings }
          const image = (file: string | undefined, alt: string) =>
            file
              ? Bun.file(file)
                  .bytes()
                  .then(
                    (bytes) =>
                      `<figure><figcaption>${alt}</figcaption><img style="max-width:100%" alt="${alt}" src="data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}"></figure>`,
                  )
              : Promise.resolve(`<p>${alt}: no capture</p>`)
          const sections = yield* io(() =>
            Promise.all(
              ordered().map(
                async (item) =>
                  `<section id="note-${item.index}-${escape(item.feedback)}"><h2>${item.index}. ${escape(item.label)} — ${escape(item.reason)}</h2>${item.width ? `<p>Verified at ${escape(DesignVerify.viewportLabel({ width: item.width, device: item.platform }))}</p>` : ""}<p>Note: ${escape(notes.find((note) => note.feedback === item.feedback && note.index === item.index)?.item.text ?? "")}</p>${await image(item.before, "Before")}${await image(item.after, "After")}<h3>Findings</h3><ul>${item.findings.map((finding) => `<li>${escape(finding)}</li>`).join("") || "<li>None</li>"}</ul><h3>Scenarios</h3><ul>${item.scenarios.map((line) => `<li>${escape(line)}</li>`).join("") || "<li>None on this screen</li>"}</ul></section>`,
              ),
            ),
          )
          yield* io(() =>
            DesignFiles.atomic(
              output,
              `<!doctype html><meta charset="utf-8"><title>Design verify</title><h1>${escape(revision.document.name)}</h1><p>Round ${round} verified on revision ${escape(revision.id)} at ${WIDTHS.join(", ")}px. Captures are evidence for the agent's per-note statuses, not approval.</p>${findings.length ? `<ul>${findings.map((finding) => `<li>${escape(finding)}</li>`).join("")}</ul>` : ""}${sections.join("\n")}`,
            ),
          )
        }

        if (job.input.format === "audit") {
          const findings: string[] = []
          const evidence: string[] = []
          const checks: Design.AuditCheck[] = []
          const captures: Design.AuditCapture[] = []
          /** Each direction's structural signature, taken once at the widest audited viewport. */
          const signatures: DesignSignature.Entry[] = []
          /** "variant screen" keys: screens the prototype declares and screens an audit view showed. */
          const declared = new Set<string>()
          const visited = new Set<string>()
          // A presentation's slides are screens even when no source marks one.
          const screensMarked = presentation || (yield* io(() => DesignQuality.mentionsScreens(root)))
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
          if (job.input.variant && !valid.includes(job.input.variant))
            return yield* new Design.Error({
              code: "invalid",
              message: `Variant ${job.input.variant} is missing from revision ${revision.id}`,
            })
          if (!job.input.variant && valid.length > 6)
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
            screen?: string,
          ) {
            const label = `${width}px${variant ? ` · ${variant}` : ""}${screen ? ` · slide ${screen}` : ""}${scenario ? ` · ${scenario}` : screen ? "" : " · initial"}`
            if (variant && !(yield* io(() => page.locator(`[data-design-variant="${variant}"]`).first().isVisible())))
              findings.push(`${label}: variant root is hidden; this direction remains unverified`)
            checks.push(
              ...(yield* io(() => page.evaluate(DesignQuality.inspect, DesignQuality.minimumControl(emulated)))).map(
                (check) => ({
                  ...check,
                  width,
                  variant,
                  scenario,
                  screen,
                }),
              ),
            )
            // Presentations are also checked per slide: content leaving the slide and text too small to project.
            if (presentation)
              checks.push(
                ...(yield* io(() => page.evaluate(DesignQuality.slide, 24))).map((check) => ({
                  ...check,
                  width,
                  variant,
                  scenario,
                  screen,
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
                  screen,
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
            yield* io(async () =>
              DesignFiles.atomic(file, await page.screenshot({ fullPage, animations: "disabled", scale: "css" })),
            )
            captures.push({ file, width, variant, scenario, screen, fullPage })
          })
          // Every direction is signed once, at the widest audited viewport (grids uncollapsed; see
          // DesignSignature.VERSION), before the per-viewport inspection, so the repetition and reuse
          // checks and their one System One request run alongside the whole audit. A presentation is
          // inspected slide by slide and is not signed. The checks get a copy of the signatures.
          const widest = sizes.toSorted((a, b) => b.width - a.width)[0]
          if (widest && !presentation) {
            yield* emulate(widest)
            for (const variant of job.input.variant ? [job.input.variant] : valid.length ? valid.slice(0, 6) : [undefined]) {
              yield* reset(variant)
              if (screensMarked)
                yield* io(() => page.waitForFunction(anyScreen, undefined, { timeout: 2000 }).catch(() => undefined))
              signatures.push({
                ...(variant ? { variant } : {}),
                width: widest.width,
                // An unsigned direction is only left out of the repetition checks; it never fails the audit.
                signature: yield* io(() => page.evaluate(DesignSignature.capture, variant ?? null)).pipe(
                  Effect.orElseSucceed(() => ""),
                ),
              })
            }
          }
          const repeating = yield* store
            .repetition(sessionID, revision, [...signatures], widest?.width ?? 0)
            .pipe(Effect.forkChild({ startImmediately: true }), Effect.map(Fiber.join))
          for (const [index, viewport] of sizes.entries()) {
            const width = viewport.width
            yield* emulate(viewport)
            for (const variant of job.input.variant
              ? [job.input.variant]
              : valid.length
                ? valid.slice(0, 6)
                : [undefined]) {
              if (captures.length >= 36) continue
              yield* reset(variant)
              if (index === 0 && screensMarked) {
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
              // A presentation is inspected slide by slide; anything else in its initial view.
              const deckSlides = presentation
                ? (yield* io(() => page.evaluate(declaredScreens))).filter(
                    (screen) => !variant || screen.variant === variant || screen.variant === "",
                  )
                : []
              for (const slide of deckSlides.slice(0, 40)) {
                if (captures.length >= 36) break
                yield* io(() =>
                  page.evaluate(openScreen, { screen: slide.id, ...(slide.variant ? { variant: slide.variant } : {}) }),
                )
                yield* visit(variant)
                yield* inspect(width, variant, undefined, slide.id)
              }
              if (!deckSlides.length) {
                if (screensMarked) yield* visit(variant)
                yield* inspect(width, variant)
              }
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
            yield* progress((index + 1) / sizes.length)
          }
          // Neither a failure nor a defect of these checks fails the audit; it is reported instead.
          const repeated = yield* repeating.pipe(
            Effect.catchTag("Design.Error", (error) => Effect.succeed(error.message)),
            Effect.catchDefect((defect) =>
              Effect.logWarning("design repetition checks failed", { defect }).pipe(
                Effect.as(defect instanceof Error ? defect.message : String(defect)),
              ),
            ),
          )
          if (typeof repeated === "string")
            findings.push(`Repetition and design-system reuse checks unavailable: ${repeated}`)
          if (typeof repeated === "object") findings.push(...repeated.findings)
          // Accepted exceptions are read from the live document, so an accept applies to this audit.
          const live = yield* store.get(sessionID, job.designID).pipe(
            Effect.map((document) => document.decisions),
            Effect.catchTag("Design.Error", () => Effect.succeed(revision.document.decisions)),
          )
          const settled = DesignQuality.settle(
            [...checks, ...(typeof repeated === "object" ? repeated.checks : [])],
            live,
            typeof repeated === "object" ? repeated.effects : undefined,
          )
          checks.splice(0, checks.length, ...settled.checks)
          findings.push(...settled.findings)
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
            signatures,
            ...(typeof repeated === "object" && repeated.reuse ? { reuse: repeated.reuse } : {}),
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
    ).pipe(Effect.timeout(`${budget} seconds`))
    yield* store.putJob(sessionID, {
      ...job,
      status: "completed",
      started,
      finished: Date.now(),
      progress: 1,
      result: output,
      ...report,
    })
  }, lock.withPermits(1))

  const start = Effect.fn("DesignRenderer.start")(function* (
    sessionID: Design.Info["sessionID"],
    id: Design.ID,
    input: Design.Render,
  ) {
    const revision = yield* store.revision(sessionID, id, input.revision)
    if (input.variant && input.format !== "audit" && input.format !== "pdf")
      return yield* new Design.Error({
        code: "invalid",
        message: "A variant filter is supported only for audits and PDF exports",
      })
    if (input.format === "pdf" && revision.document.target !== "presentation")
      return yield* new Design.Error({
        code: "invalid",
        message: "PDF export prints presentation slides; this design's target is not presentation",
      })
    // Two renders per note plus scoped checks; the round decides the budget, bounded to half an hour.
    let budget = 120
    if (input.format === "verify") {
      // Fail now, in the tool result, rather than in a job the agent has to poll for.
      const document = yield* store.get(sessionID, id)
      const round = input.round ?? DesignRounds.latest(document)?.number
      if (round === undefined)
        return yield* new Design.Error({
          code: "invalid",
          message: "No feedback round to verify yet; notes arrive from the review page",
        })
      if (!DesignRounds.notes(document, round).length)
        return yield* new Design.Error({ code: "invalid", message: `Round ${round} has no notes to verify` })
      budget = Math.min(1800, 90 + 50 * DesignRounds.notes(document, round).length)
    }
    const candidate =
      input.format === "compare"
        ? yield* store.implementation(sessionID, id, input.implementation ?? "dist")
        : undefined
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
    yield* store.putJob(sessionID, job)
    // The budget starts once the render holds the renderer and is prepared; queue time never counts.
    const fiber = yield* render(sessionID, job, budget).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          // A job that did not finish keeps no captures; a verify's finished notes stay on the job.
          const exports = path.join(store.storage, id, "exports")
          yield* Effect.promise(() =>
            readdir(exports)
              .then((names) =>
                Promise.all(
                  names
                    .filter((name) => name.startsWith(`${job.id}-`))
                    .map((name) => rm(path.join(exports, name), { force: true })),
                ),
              )
              .catch(() => undefined),
          )
          const current = (yield* store.jobs(sessionID, id)).find((item) => item.id === job.id)
          const failure = Cause.squash(cause)
          yield* store.putJob(sessionID, {
            ...job,
            ...(current?.verify
              ? {
                  verify: {
                    ...current.verify,
                    notes: current.verify.notes.map((note) => ({ ...note, before: undefined, after: undefined })),
                  },
                }
              : {}),
            status: Cause.hasInterrupts(cause) ? "interrupted" : "failed",
            // The agent reads this error back: a Design failure is its message, never a stack trace.
            error:
              !Cause.hasInterrupts(cause) && failure instanceof Design.Error ? failure.message : Cause.pretty(cause),
            finished: Date.now(),
          })
        }),
      ),
      Effect.asVoid,
      Effect.ensuring(Effect.sync(() => active.delete(job.id))),
      Effect.forkIn(scope),
    )
    active.set(job.id, fiber)
    return job
  })

  const cancel = Effect.fn("DesignRenderer.cancel")(function* (
    sessionID: Design.Info["sessionID"],
    id: Design.ID,
    jobID: string,
  ) {
    const job = (yield* store.jobs(sessionID, id)).find((job) => job.id === jobID)
    if (!job) return yield* new Design.Error({ code: "not-found", message: "Render job not found" })
    const fiber = active.get(jobID)
    if (fiber) yield* Fiber.interrupt(fiber)
    const current = (yield* store.jobs(sessionID, id)).find((item) => item.id === jobID)!
    if (current.status === "completed" || current.status === "failed" || current.status === "cancelled") return current
    yield* io(() =>
      rm(path.join(store.storage, id, "exports", `${jobID}.${Design.exportFile(job.input.format).extension}`), {
        force: true,
      }),
    )
    return yield* store.putJob(sessionID, { ...job, status: "cancelled", finished: Date.now() })
  })
  const jobs = Effect.fn("DesignRenderer.jobs")(function* (sessionID: Design.Info["sessionID"], id: Design.ID) {
    return yield* Effect.forEach(yield* store.jobs(sessionID, id), (job) =>
      (job.status === "running" || job.status === "queued") && !active.has(job.id)
        ? store.putJob(sessionID, { ...job, status: "interrupted", finished: Date.now() })
        : Effect.succeed(job),
    )
  })
  return { start, cancel, jobs, directory }
})

/** Renders, exports and previews in the location's process. */
export type Interface = Effect.Success<typeof make>
export const layer = Layer.effect(DesignRenderer.Service, make)

export const node = makeLocationNode({
  service: DesignRenderer.Service,
  layer,
  deps: [DesignStore.node, AppProcess.node],
})
