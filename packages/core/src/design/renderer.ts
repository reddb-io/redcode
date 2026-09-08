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

const io = <A>(run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      new Design.Error({ code: "unavailable", message: error instanceof Error ? error.message : String(error) }),
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
    const report: { audit?: Design.Audit } = {}
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
          yield* io(() => DesignFiles.atomic(output, html))
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
                  await route.fulfill({
                    body: Buffer.from(await Bun.file(file).bytes()),
                    contentType: Bun.file(file).type,
                  })
                }),
              )
              yield* io(() => page.setViewportSize({ width, height: 900 }))
              for (const scenario of scenarios.length ? scenarios : [undefined]) {
                yield* io(() => page.goto(`http://design.local/${source === root ? entry : "index.html"}`))
                yield* io(() => page.evaluate(() => document.fonts.ready.then(() => undefined)))
                const outcome = yield* io(async () => {
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

        if (job.input.format === "audit") {
          const findings: string[] = []
          const evidence: string[] = []
          const { AxeBuilder } = yield* io((signal) => DesignRuntime.load("@axe-core/playwright", signal))
          for (const width of [390, 768, 1440]) {
            yield* io(() => page.setViewportSize({ width, height: 900 }))
            for (const scenario of revision.document.scenarios) {
              if (scenario.notApplicable) continue
              yield* io(() => page.goto(`http://design.local/${entry}`, { waitUntil: "load" }))
              yield* io(() => page.evaluate(() => document.fonts.ready.then(() => undefined)))
              const result = yield* io(async () => {
                for (const action of scenario.actions) {
                  const target = page.locator(action.selector)
                  if (action.action === "click") await target.click()
                  if (action.action === "fill") await target.fill(action.value ?? "")
                  if (action.action === "press") await target.press(action.value ?? "Enter")
                }
                const target = page.locator(scenario.selector)
                await target.waitFor({ state: "visible" })
                return (await target.getAttribute("data-state")) === scenario.state
              }).pipe(Effect.catchTag("Design.Error", (error) => Effect.succeed(error.message)))
              if (result !== true)
                findings.push(
                  `${width}px · ${scenario.name}: ${typeof result === "string" ? result : "state does not match"}`,
                )
              if (result === true) evidence.push(`${width}px · ${scenario.name}: exercised`)
            }
            const layout = yield* io(() =>
              page.evaluate(() => ({
                overflow: document.documentElement.scrollWidth > innerWidth + 1,
                unnamed: [...document.querySelectorAll("button,input,select,textarea")].filter((element) => {
                  if (!(element instanceof HTMLElement) || element.offsetParent === null) return false
                  return (
                    !element.getAttribute("aria-label") &&
                    !element.getAttribute("aria-labelledby") &&
                    !element.textContent?.trim() &&
                    !("labels" in element && (element as HTMLInputElement).labels?.length)
                  )
                }).length,
              })),
            )
            if (layout.overflow) findings.push(`${width}px: horizontal overflow`)
            if (layout.unnamed) findings.push(`${width}px: ${layout.unnamed} controls without accessible names`)
            const accessibility = yield* io(() =>
              new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze(),
            )
            findings.push(
              ...accessibility.violations.map(
                (violation) => `${width}px · ${violation.id}: ${violation.help} (${violation.nodes.length} elements)`,
              ),
            )
            yield* io(() => page.keyboard.press("Tab"))
            const focus = yield* io(() =>
              page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null),
            )
            if (!focus) findings.push(`${width}px: keyboard Tab did not reach an interactive element`)
            yield* io(async () =>
              DesignFiles.atomic(path.join(path.dirname(output), `${job.id}-${width}.png`), await page.screenshot()),
            )
          }
          if (!revision.document.scenarios.length) findings.push("No scenarios have been exercised")
          report.audit = { revision: revision.id, findings, scenarios: evidence, widths: [390, 768, 1440] }
          const escape = (text: string) =>
            text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
          const screenshots = yield* io(() =>
            Promise.all(
              [390, 768, 1440].map(
                async (width) =>
                  `<h2>${width}px</h2><img style="max-width:100%" alt="${width}px rendered state" src="data:image/png;base64,${Buffer.from(await Bun.file(path.join(path.dirname(output), `${job.id}-${width}.png`)).bytes()).toString("base64")}">`,
              ),
            ),
          )
          yield* io(() =>
            DesignFiles.atomic(
              output,
              `<!doctype html><meta charset="utf-8"><title>Design audit</title><h1>${escape(revision.document.name)}</h1><p>Revision ${escape(revision.id)}</p><h2>Exercised scenarios</h2><ul>${evidence.map((item) => `<li>${escape(item)}</li>`).join("")}</ul><h2>Findings</h2><ul>${findings.map((finding) => `<li>${escape(finding)}</li>`).join("")}</ul>${screenshots.join("")}`,
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
      Effect.timeout("120 seconds"),
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
