import { Automation } from "@opencode/schema/automation"
import { DateTime, Option, Schema } from "effect"
import { useClient } from "../context/client"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"

/** A guided creation flow; cancellation at any step leaves the server unchanged. */
export function useAutomationCommand() {
  const client = useClient()
  const dialog = useDialog()
  const toast = useToast()
  const ask = (title: string, placeholder: string) =>
    new Promise<string | undefined>((resolve) => {
      dialog.replace(
        () => (
          <DialogPrompt
            title={title}
            placeholder={placeholder}
            onConfirm={(value) => {
              resolve(value.trim())
              dialog.clear()
            }}
            onCancel={() => dialog.clear()}
          />
        ),
        () => resolve(undefined),
      )
    })
  const choose = <T extends string>(title: string, options: { title: string; value: T; description?: string }[]) =>
    new Promise<T | undefined>((resolve) => {
      dialog.replace(
        () => (
          <DialogSelect
            title={title}
            renderFilter={false}
            options={options}
            onSelect={(option) => {
              resolve(option.value)
              dialog.clear()
            }}
          />
        ),
        () => resolve(undefined),
      )
    })
  const run = async (sessionID: string) => {
    const title = await ask("Automation name", "Build health")
    if (!title) return
    const prompt = await ask("Prompt to queue when the condition is met", "Investigate and report")
    if (!prompt) return
    if (title.length > 160 || prompt.length > 16_000) {
      toast.show({
        variant: "warning",
        message: "The name must be at most 160 characters and the prompt at most 16000.",
      })
      return
    }
    const scheduleType = await choose("Schedule", [
      { title: "Repeat at an interval", value: "interval" },
      { title: "Once at a specified time", value: "once" },
      { title: "Weekly calendar", value: "fixed_time" },
    ] as const)
    if (!scheduleType) return
    let candidate: unknown
    let scheduleLabel = ""
    if (scheduleType === "interval") {
      const minutes = await ask("Check interval in minutes", "10")
      if (!minutes) return
      const value = Number(minutes)
      candidate = { type: "interval", everyMs: value * 60_000 }
      scheduleLabel = `every ${value} min`
    } else if (scheduleType === "once") {
      const time = await ask("Execution time with UTC offset", "2026-11-06T14:00:00-03:00")
      if (!time) return
      const at = Date.parse(time)
      if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(time) || !Number.isFinite(at) || at <= Date.now()) {
        toast.show({ variant: "warning", message: "Enter a future ISO date and time including Z or a UTC offset." })
        return
      }
      candidate = { type: "once", at }
      scheduleLabel = `once at ${time}`
    } else {
      const timeOfDay = await ask("Time of day (HH:MM)", "09:00")
      if (!timeOfDay) return
      const timeZone = await ask("Named time zone", "America/Sao_Paulo")
      if (!timeZone) return
      const days = await ask("Weekdays: 1=Monday, 7=Sunday", "1,2,3,4,5")
      if (!days) return
      if (Option.isNone(DateTime.zoneMakeNamed(timeZone))) {
        toast.show({ variant: "warning", message: "Enter a valid named time zone." })
        return
      }
      candidate = {
        type: "fixed_time",
        timeOfDay,
        timeZone,
        weekdays: days.split(",").map((day) => Number(day.trim())),
      }
      scheduleLabel = `${timeOfDay} ${timeZone} · days ${days}`
    }
    const decoded = Schema.decodeUnknownOption(Automation.Schedule)(candidate)
    if (Option.isNone(decoded)) {
      toast.show({ variant: "warning", message: "Invalid schedule. Check the time, weekdays or interval." })
      return
    }
    const kind = await choose("Condition", [
      { title: "HTTP endpoint returns a successful status", value: "http" },
      { title: "A process is running", value: "process" },
    ] as const)
    if (!kind) return
    const target = await ask(
      kind === "http" ? "HTTP or HTTPS URL" : "Process name",
      kind === "http" ? "https://example.com/health" : "node",
    )
    if (!target) return
    if (kind === "http") {
      try {
        const url = new URL(target)
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error()
      } catch {
        toast.show({ variant: "warning", message: "Enter an HTTP or HTTPS URL without credentials." })
        return
      }
    }
    const when = await choose("Trigger when", [
      { title: "The condition matches", value: "matches" },
      { title: "The condition does not match", value: "not_matches" },
    ] as const)
    if (!when) return
    // A single observation cannot detect a transition, so only offer it for recurring schedules.
    const mode =
      decoded.value.type === "once"
        ? "on_match"
        : await choose("When to run", [
            { title: "Every matching check", value: "on_match" },
            { title: "Only when it becomes true (first check sets baseline)", value: "on_change" },
          ] as const)
    if (!mode) return
    const review = await choose(`Create “${title}” ${scheduleLabel}?`, [
      {
        title: `${kind === "http" ? "HTTP" : "Process"}: ${target} · ${when === "matches" ? "matches" : "does not match"} · ${mode === "on_change" ? "on change" : "each check"}`,
        description: `Prompt: ${prompt}`,
        value: "create",
      },
      { title: "Cancel", value: "cancel" },
    ] as const)
    if (review !== "create") return
    const condition: Automation.Condition = {
      probe: kind === "http" ? { type: "http", url: target } : { type: "process", name: target, state: "running" },
      when,
      mode,
    }
    const input = { id: Automation.ID.create(), title, prompt, schedule: decoded.value, condition }
    while (true) {
      try {
        await client.api.automation.createConditional({ sessionID, ...input })
        toast.show({ variant: "success", message: "Conditional automation created for this conversation." })
        return
      } catch (error) {
        toast.error(error)
        const retry = await choose("Creation failed. Retry or cancel.", [
          { title: "Retry the same request", value: "retry" },
          { title: "Cancel", value: "cancel" },
        ] as const)
        if (retry !== "retry") return
      }
    }
  }
  return { run }
}
