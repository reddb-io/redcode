import { createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { useSpring } from "@opencode/ui/motion-spring"
import { showToast } from "@/shell/notifications/toast"
import type { FormAnswer, FormInfo, FormMultiselectField, FormStringField } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { ScopedKey } from "@/runtime/server/scope"
import { useCommand } from "@/shell/commands/command"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { SessionQuestionDockView } from "./session-question-dock.react"

const cache = new Map<string, { tab: number; answers: string[][]; custom: string[]; customOn: boolean[] }>()

const IS_MAC = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

type QuestionField = FormStringField | FormMultiselectField

function questionField(field: FormInfo["fields"][number]): field is QuestionField {
  return field.type === "string" || field.type === "multiselect"
}

export function createSessionQuestionServices(props: {
  request: FormInfo
  onSubmit: () => void
  onReply?: (answer: FormAnswer) => Promise<void>
  onCancel?: () => Promise<void>
  cacheScope?: string
  disabled?: boolean
}) {
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const command = useCommand()
  const cacheKey = props.cacheScope
    ? `${props.cacheScope}\0${props.request.id}`
    : ScopedKey.from(serverSDK.scope, props.request.id)

  const questions = createMemo(() =>
    props.request.fields.filter(questionField).map((field) => ({
      field,
      header: field.title ?? "",
      question: field.description ?? field.title ?? "",
      options: field.type === "string" ? (field.options ?? []) : field.options,
      multiple: field.type === "multiselect",
    })),
  )

  const total = createMemo(() => questions().length)

  const cached = cache.get(cacheKey)

  const [store, setStore] = createStore({
    tab: cached?.tab ?? 0,
    answers: cached?.answers ?? ([] as string[][]),
    custom: cached?.custom ?? ([] as string[]),
    customOn: cached?.customOn ?? ([] as boolean[]),
    editing: false,
    focus: 0,
    focusRequest: 0,
    minimized: false,
    optionsHeight: 180,
  })

  let replied = false

  const question = createMemo(() => questions()[store.tab])
  const options = createMemo(() => question()?.options ?? [])
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const on = createMemo(() => store.customOn[store.tab] === true)
  const multi = createMemo(() => question()?.multiple === true)
  const count = createMemo(() => options().length + 1)

  const summary = createMemo(() => {
    const n = Math.min(store.tab + 1, total())

    return language.t("session.question.progress", { current: n, total: total() })
  })

  const customLabel = () => language.t("ui.messagePart.option.typeOwnAnswer")
  const customPlaceholder = () => language.t("ui.question.custom.placeholder")

  const last = createMemo(() => store.tab >= total() - 1)
  const collapse = useSpring(() => (store.minimized ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const hidden = createMemo(() => Math.max(0, Math.min(1, collapse())))
  const optionsOff = createMemo(() => hidden() > 0.98)

  const customUpdate = (value: string, selected: boolean = on()) => {
    const prev = input().trim()
    const next = value.trim()

    setStore("custom", store.tab, value)

    if (!selected) return

    if (multi()) {
      setStore("answers", store.tab, (current = []) => {
        const removed = prev ? current.filter((item) => item.trim() !== prev) : current

        if (!next) return removed

        if (removed.some((item) => item.trim() === next)) return removed

        return [...removed, next]
      })

      return
    }

    setStore("answers", store.tab, next ? [next] : [])
  }

  const clamp = (i: number) => Math.max(0, Math.min(count() - 1, i))

  const pickFocus = (tab: number = store.tab) => {
    const list = questions()[tab]?.options ?? []

    if (store.customOn[tab] === true) return list.length

    return Math.max(
      0,
      list.findIndex((item) => store.answers[tab]?.includes(item.value) ?? false),
    )
  }

  // Native options receive focus only after React commits the requested view.
  const focus = (i: number) => {
    setStore("focus", clamp(i))
    if (!store.editing) setStore("focusRequest", (request) => request + 1)
  }

  onCleanup(() => {
    if (replied) return
    cache.set(cacheKey, {
      tab: store.tab,
      answers: store.answers.map((a) => (a ? [...a] : [])),
      custom: store.custom.map((s) => s ?? ""),
      customOn: store.customOn.map((b) => b ?? false),
    })
  })

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    showToast({ title: language.t("common.requestFailed"), description: message })
  }

  const replyMutation = useMutation(() => ({
    mutationFn: (answer: FormAnswer) =>
      props.onReply
        ? props.onReply(answer)
        : serverSDK.api.session.form.reply({ sessionID: props.request.sessionID, formID: props.request.id, answer }),
    onMutate: () => {
      props.onSubmit()
    },
    onSuccess: () => {
      replied = true
      cache.delete(cacheKey)
    },
    onError: fail,
  }))

  const rejectMutation = useMutation(() => ({
    mutationFn: () =>
      props.onCancel
        ? props.onCancel()
        : serverSDK.api.session.form.cancel({ sessionID: props.request.sessionID, formID: props.request.id }),
    onMutate: () => {
      props.onSubmit()
    },
    onSuccess: () => {
      replied = true
      cache.delete(cacheKey)
    },
    onError: fail,
  }))

  const sending = createMemo(() => props.disabled || replyMutation.isPending || rejectMutation.isPending)
  const submitShortcut = () => (IS_MAC ? "⌘⏎" : `${language.t("common.key.ctrl")}+⏎`)
  const backShortcut = () => (IS_MAC ? "⌘[" : `${language.t("common.key.alt")}+←`)

  const reply = (answer: FormAnswer) => {
    if (sending()) return
    replyMutation.mutate(answer)
  }

  const reject = () => {
    if (sending()) return
    rejectMutation.mutate()
  }

  const submit = () =>
    reply(
      Object.fromEntries(
        questions().flatMap((question, index) => {
          const answers = store.answers[index] ?? []

          if (answers.length === 0) return []

          return [[question.field.key, question.multiple ? answers : answers[0]]]
        }),
      ),
    )

  const answered = (i: number) => {
    if ((store.answers[i]?.length ?? 0) > 0) return true

    return store.customOn[i] === true && (store.custom[i] ?? "").trim().length > 0
  }

  const picked = (answer: string) => store.answers[store.tab]?.includes(answer) ?? false

  const pick = (answer: string, custom: boolean = false) => {
    setStore("answers", store.tab, [answer])

    if (custom) setStore("custom", store.tab, answer)

    if (!custom) setStore("customOn", store.tab, false)
    setStore("editing", false)
  }

  const toggle = (answer: string) => {
    setStore("answers", store.tab, (current = []) => {
      if (current.includes(answer)) return current.filter((item) => item !== answer)

      return [...current, answer]
    })
  }

  const customToggle = () => {
    if (sending()) return
    setStore("focus", options().length)

    if (!multi()) {
      setStore("customOn", store.tab, true)
      setStore("editing", true)
      customUpdate(input(), true)

      return
    }

    const next = !on()
    setStore("customOn", store.tab, next)

    if (next) {
      setStore("editing", true)
      customUpdate(input(), true)

      return
    }

    const value = input().trim()

    if (value) setStore("answers", store.tab, (current = []) => current.filter((item) => item.trim() !== value))
    setStore("editing", false)
    focus(options().length)
  }

  const customOpen = () => {
    if (sending()) return
    setStore("focus", options().length)

    if (!on()) setStore("customOn", store.tab, true)
    setStore("editing", true)
    customUpdate(input(), true)
  }

  const move = (step: number) => {
    if (store.editing || sending()) return
    focus(store.focus + step)
  }

  const nav = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return

    if (event.key === "Escape") {
      event.preventDefault()
      reject()

      return
    }

    const previous = IS_MAC
      ? event.metaKey && !event.ctrlKey && !event.altKey && event.key === "["
      : event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowLeft"

    if (previous) {
      if (event.repeat) return
      event.preventDefault()
      back()

      return
    }

    const mod = (event.metaKey || event.ctrlKey) && !event.altKey

    if (mod && event.key === "Enter") {
      if (event.repeat) return
      event.preventDefault()
      next()

      return
    }

    const target =
      event.target instanceof HTMLElement ? event.target.closest('[data-slot="question-options"]') : undefined

    if (store.editing) return

    if (!(target instanceof HTMLElement)) return

    if (event.altKey || event.ctrlKey || event.metaKey) return

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault()
      move(1)

      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault()
      move(-1)

      return
    }

    if (event.key === "Home") {
      event.preventDefault()
      focus(0)

      return
    }

    if (event.key !== "End") return
    event.preventDefault()
    focus(count() - 1)
  }

  const selectOption = (optIndex: number) => {
    if (sending()) return

    if (optIndex === options().length) {
      customOpen()

      return
    }

    const opt = options()[optIndex]

    if (!opt) return

    if (multi()) {
      setStore("editing", false)
      toggle(opt.value)

      return
    }

    pick(opt.value)
  }

  const commitCustom = () => {
    setStore("editing", false)
    customUpdate(input())
    focus(options().length)
  }

  const next = () => {
    if (sending()) return

    if (store.editing) commitCustom()

    if (store.tab >= total() - 1) {
      submit()

      return
    }

    const tab = store.tab + 1
    setStore("tab", tab)
    setStore("editing", false)

    if (!store.minimized) focus(pickFocus(tab))
  }

  const back = () => {
    if (sending()) return

    if (store.tab <= 0) return
    const tab = store.tab - 1
    setStore("tab", tab)
    setStore("editing", false)

    if (!store.minimized) focus(pickFocus(tab))
  }

  const jump = (tab: number) => {
    if (sending()) return
    setStore("tab", tab)
    setStore("editing", false)

    if (!store.minimized) focus(pickFocus(tab))
  }

  command.register("session.question.back", () => [
    {
      id: "session.question.back",
      title: language.t("ui.common.back"),
      keybind: IS_MAC ? "mod+[" : "alt+arrowleft",
      hidden: true,
      // Stay registered while sending so the shortcut does not fall through to history navigation.
      disabled: store.tab <= 0,
      when: () => store.tab > 0,
      onSelect: back,
    },
  ])

  const minimize = () => {
    if (sending()) return
    setStore("editing", false)
    setStore("minimized", true)
  }

  const restore = () => {
    if (sending()) return
    setStore("minimized", false)
    focus(pickFocus())
  }

  focus(pickFocus())

  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      summary: summary(),
      question: question()?.question,
      progress: questions().map((_, index) => ({
        label: language.t("ui.tool.questions.numbered", { number: index + 1 }),
        answered: answered(index),
      })),
      options: options().map((option) => ({ ...option, picked: picked(option.value) })),
      tab: store.tab,
      multiple: multi(),
      input: input(),
      custom: on(),
      customLabel: customLabel(),
      customPlaceholder: customPlaceholder(),
      editing: store.editing,
      minimized: store.minimized,
      hidden: hidden(),
      optionsOff: optionsOff(),
      optionsHeight: store.optionsHeight,
      focus: store.focus,
      focusRequest: store.focusRequest,
      sending: sending(),
      last: last(),
      submitShortcut: submitShortcut(),
      backShortcut: backShortcut(),
      backKeys: IS_MAC ? "Meta+[" : "Alt+ArrowLeft",
    })),
    nav,
    next,
    back,
    jump,
    reject,
    minimize,
    restore,
    selectOption,
    customOpen,
    customToggle,
    customUpdate,
    commitCustom,
    focused: (index: number) => setStore("focus", index),
    measureOptions: (height: number) => setStore("optionsHeight", (previous) => Math.max(previous, height)),
    cancelCustom: () => {
      setStore("editing", false)
      focus(options().length)
    },
  }
}

export function SessionQuestionDock(props: Parameters<typeof createSessionQuestionServices>[0]) {
  const services = createSessionQuestionServices(props)
  return <ReactView component={SessionQuestionDockView} props={{ services }} />
}
