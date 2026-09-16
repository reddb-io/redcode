/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { BootTrace } from "@reddb-io/redcode-core/observability/boot-trace"
import { VerboseIndicator, verboseIndicatorText } from "../../src/component/verbose-indicator"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { tmpdir } from "../fixture/fixture"
import { mount } from "../cli/cmd/tui/sync-fixture"

const saved = { verbose: process.env.REDCODE_VERBOSE, file: process.env.REDCODE_VERBOSE_BOOT_FILE }

afterEach(() => {
  BootTrace.reset()
  if (saved.verbose === undefined) delete process.env.REDCODE_VERBOSE
  else process.env.REDCODE_VERBOSE = saved.verbose
  if (saved.file === undefined) delete process.env.REDCODE_VERBOSE_BOOT_FILE
  else process.env.REDCODE_VERBOSE_BOOT_FILE = saved.file
})

function Indicator() {
  return (
    <TuiConfigProvider config={createTuiResolvedConfig()}>
      <ThemeProvider mode="dark">
        <VerboseIndicator />
      </ThemeProvider>
    </TuiConfigProvider>
  )
}

test("shows where the verbose trace went while the screen owns the terminal", async () => {
  process.env.REDCODE_VERBOSE = "1"
  process.env.REDCODE_VERBOSE_BOOT_FILE = "/tmp/redcode/boot-20260916T120000Z-1.log"
  BootTrace.reset()
  const setup = await mount(undefined, (await tmpdir()).path, () => <Indicator />, { width: 100, height: 6 })
  try {
    await setup.app.renderOnce()
    const frame = setup.app.captureCharFrame()
    expect(frame).toContain("verbose · log: /tmp/redcode/boot-20260916T120000Z-1.log")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("renders nothing without --verbose", async () => {
  delete process.env.REDCODE_VERBOSE
  BootTrace.reset()
  expect(verboseIndicatorText()).toBeUndefined()
  const setup = await mount(undefined, (await tmpdir()).path, () => <Indicator />, { width: 100, height: 6 })
  try {
    await setup.app.renderOnce()
    expect(setup.app.captureCharFrame()).not.toContain("verbose")
  } finally {
    setup.app.renderer.destroy()
  }
})
