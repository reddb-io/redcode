import { showToast } from "@opencode/ui/toast"
import { createSignal, lazy, onCleanup, Suspense } from "solid-js"
import { createKeyed, onIdle, Command, SettingsPage, type Setup, type SetupContext } from "../sdk"
import type definition from "./index"

const setup: Setup<typeof definition> = (ctx) => {
  whatsNew(ctx)

  if (!ctx.desktop) return
  const updater = ctx.uses.updater
  const [checking, setChecking] = createSignal(false)

  // Undefined while main is not active.
  const upgradable = () => {
    const live = updater()

    return live.status === "active" ? live.value.state()?.upgradable : undefined
  }

  const check = () => {
    const live = updater()

    // Not loaded yet, or gone (disabled, failed, blocked, restarting): nothing can check or upgrade.
    if (live.status !== "active") return void showToast({ title: ctx.t("common.requestFailed") })

    if (!upgradable()) return void showToast({ title: ctx.t("check.title"), description: ctx.t("check.development") })

    if (checking()) return
    setChecking(true)
    void import("./actions").then((module) => module.check(ctx, live.value)).finally(() => setChecking(false))
  }

  const Section = lazy(() => import("./section"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  onCleanup(onIdle(() => void Section.preload()))

  ctx.add(SettingsPage, {
    id: "updates",
    page: "general",
    available: "desktop",
    get title() {
      return ctx.t("section.title")
    },
    get entries() {
      return [
        { id: "settings-release-notes", title: ctx.t("releaseNotes.title") },
        { id: "settings-check-updates", title: ctx.t("check.title") },
      ]
    },
    render: () => (
      <Suspense>
        <Section upgradable={upgradable} checking={checking} run={check} />
      </Suspense>
    ),
  })

  ctx.add(Command, {
    id: "check",
    get title() {
      return ctx.t("menu.check")
    },
    hidden: true,
    run: check,
  })

  // The app menu's Check for Updates answers in the focused window. The listener ends with the generation of the main
  // side that sends it.
  createKeyed(updater, (client) => void client.on("check", check))
}

/**
 * What's New after an update, on every platform: the release highlights since the version last seen. The first run
 * and a disabled What's New only remember the version.
 */
function whatsNew(ctx: SetupContext<typeof definition>) {
  const version = ctx.build.version
  const seen = ctx.stores.seen
  const previous = seen.value.version

  if (!version || previous === version) return

  const markSeen = () =>
    seen.update((draft) => {
      draft.version = version
    })

  if (!previous || !ctx.stores.releaseNotes.value.enabled) return markSeen()

  void import("./whats-new").then((module) => {
    if (ctx.signal.aborted) return

    module.showWhatsNew(ctx, { previous, current: version, markSeen })
  })
}

export default setup
