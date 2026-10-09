import { createSignal } from "solid-js"
import type { UiI18n } from "@opencode/ui/context/i18n"

const [time, setTime] = createSignal(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
let demanded = false

/**
 * The one 1s clock every live timer reads. It runs only while something keeps reading it:
 * each tick re-runs the readers, a reader that is still live reads again, and a tick that
 * nobody read stops the interval.
 */
export function now() {
  demanded = true
  timer ??= setInterval(() => {
    if (!demanded) {
      clearInterval(timer)
      timer = undefined
      return
    }
    demanded = false
    setTime(Date.now())
  }, 1000)
  return Math.max(time(), Date.now() - 999)
}

/** "12s", "4m 50s", "1h 3m": the elapsed-time format of turn headers and live timers. */
export function formatElapsed(ms: number, i18n: Pick<UiI18n, "t" | "locale">) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const numfmt = new Intl.NumberFormat(i18n.locale())
  if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt.format(total) })
  if (total < 3600)
    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numfmt.format(Math.floor(total / 60)),
      seconds: numfmt.format(total % 60),
    })
  return i18n.t("ui.message.duration.hoursMinutes", {
    hours: numfmt.format(Math.floor(total / 3600)),
    minutes: numfmt.format(Math.floor((total % 3600) / 60)),
  })
}
