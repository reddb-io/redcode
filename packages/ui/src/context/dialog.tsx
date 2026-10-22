import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  type Owner,
  type ParentProps,
  runWithOwner,
  useContext,
  type JSX,
  startTransition,
  For,
  Show,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"

type DialogElement = () => JSX.Element

type Active = {
  id: string
  node: JSX.Element
  dispose: () => void
  owner: Owner
  onClose?: () => void
  setClosing: (closing: boolean) => void
  restoreFocus: () => void
}

const Context = createContext<ReturnType<typeof init>>()

// Lets the dialog rendered in a layer opt out of closing on a backdrop click.
const LayerContext = createContext<{
  setBackdropDismiss: (value: boolean) => void
  setNative: (value: boolean) => void
  closing: () => boolean
  close: () => void
}>()

export function useDialogLayer() {
  return useContext(LayerContext)
}

function init() {
  const [stack, setStack] = createSignal<Active[]>([])
  // A dialog is closing from the moment its close starts until its exit animation ends and it is disposed.
  const closing = new Map<string, ReturnType<typeof setTimeout> | undefined>()
  // The same ids, reactive, so the top dialog that stays open owns the focus trap during an exit animation.
  const [exiting, setExiting] = createSignal<ReadonlySet<string>>(new Set())
  const lock = { value: false }
  const state = { disposed: false }

  // Detach the stack before disposing, so cleanups that close dialogs find nothing to admit. Every dialog is
  // drained even when one throws. A replaced dialog that was not already closing still hears onClose.
  const disposeAll = (notify: boolean) => {
    const items = stack()
    const exited = new Set(closing.keys())
    setStack([])
    closing.forEach((timer) => clearTimeout(timer))
    closing.clear()
    setExiting(new Set<string>())
    items.forEach((item) => {
      if (notify && !exited.has(item.id)) isolate(() => item.onClose?.())
      isolate(item.dispose)
    })
  }

  onCleanup(() => {
    state.disposed = true
    disposeAll(false)
  })

  const finish = (current: Active) => {
    // Scheduled first, so the dialog still goes away when a callback throws.
    closing.set(
      current.id,
      setTimeout(() => {
        closing.delete(current.id)

        if (closing.size === 0) lock.value = false
        setExiting((ids) => new Set([...ids].filter((id) => id !== current.id)))
        setStack((items) => items.filter((item) => item.id !== current.id))
        current.dispose()
        // React releases the native modal in its deferred root teardown before restoring the stack's opener.
        queueMicrotask(current.restoreFocus)
      }, 100),
    )
    setExiting((ids) => new Set([...ids, current.id]))
    isolate(() => current.onClose?.())
    current.setClosing(true)
  }

  /** Programmatic close. Without an id it closes the top dialog, one at a time; with an id it never waits. */
  const close = (id?: string) => {
    const current = id ? stack().find((item) => item.id === id) : stack().at(-1)

    if (!current || closing.has(current.id) || (!id && lock.value)) return
    closing.set(current.id, undefined)
    lock.value = true
    finish(current)
  }

  /** Escape, a backdrop click, or Kobalte dismissing: only the top dialog, and one per exit animation. */
  const dismiss = (id?: string) => {
    const current = stack().at(-1)

    if (!current || (id && current.id !== id) || closing.has(current.id) || lock.value) return
    closing.set(current.id, undefined)
    lock.value = true
    finish(current)
  }

  createEffect(() => {
    if (stack().length === 0) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      // Native DS dialogs and their portalled popups own dismissal and focus restoration.
      if (document.querySelector("dialog[open]")) return
      dismiss()
      event.preventDefault()
      event.stopPropagation()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  const mount = (
    element: DialogElement,
    owner: Owner,
    onClose: (() => void) | undefined,
    key: string | undefined,
    opener: HTMLElement | undefined,
  ) => {
    // A deferred open (e.g. from a focus callback) must not mount after the provider is gone.
    if (state.disposed) return
    const id = key ?? Math.random().toString(36).slice(2)

    // The layer follows the dialog's current place in the stack, so a new top dialog always renders above.
    const layer = () =>
      Math.max(
        0,
        stack().findIndex((item) => item.id === id),
      )

    const zIndex = () => String(50 + layer() * 10)
    let dispose: (() => void) | undefined
    let setClosing: ((closing: boolean) => void) | undefined
    const focus = { native: false }

    // Stacked dialogs render as sibling portals, so only the top layer may own the focus trap.
    const node = runWithOwner(owner, () =>
      createRoot((d: () => void) => {
        dispose = d
        const [closing, setClosingSignal] = createSignal(false)
        const [backdropDismiss, setBackdropDismiss] = createSignal(true)
        const [native, setNative] = createSignal(false)
        createEffect(() => {
          focus.native = native()
        })
        setClosing = setClosingSignal

        return (
          <Kobalte
            modal={!native() && stack().findLast((item) => !exiting().has(item.id))?.id === id}
            open={!closing()}
            onOpenChange={(open: boolean) => {
              if (!open) dismiss(id)
            }}
          >
            <Kobalte.Portal>
              <Show when={!native()}>
                <Kobalte.Overlay
                  data-component="dialog-overlay"
                  style={{ "z-index": zIndex() }}
                  onClick={() => {
                    if (backdropDismiss()) dismiss(id)
                  }}
                />
              </Show>
              <div
                data-dialog-layer={layer()}
                style={{
                  position: "fixed",
                  inset: "0",
                  "z-index": zIndex(),
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "pointer-events": native() ? "auto" : "none",
                }}
              >
                <LayerContext.Provider value={{ setBackdropDismiss, setNative, closing, close: () => close(id) }}>
                  {element()}
                </LayerContext.Provider>
              </div>
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )

    if (!dispose || !setClosing) return

    const active: Active = {
      id,
      node,
      dispose,
      owner,
      onClose,
      setClosing,
      restoreFocus: () => {
        if (focus.native && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
      },
    }
    setStack((items) => [...items, active])
  }

  const push = (
    element: DialogElement,
    owner: Owner,
    onClose: (() => void) | undefined,
    id: string | undefined,
    opener: HTMLElement | undefined,
  ) => {
    lock.value = false
    mount(element, owner, onClose, id, opener)
  }

  const show = (
    element: DialogElement,
    owner: Owner,
    onClose: (() => void) | undefined,
    id: string | undefined,
    opener: HTMLElement | undefined,
  ) => {
    disposeAll(true)
    lock.value = false
    mount(element, owner, onClose, id, opener)
  }

  return {
    stack,
    close,
    show,
    push,
  }
}

function dialogOpener() {
  const focused = document.activeElement
  if (!(focused instanceof HTMLElement)) return
  const menu = focused.closest('[role="menu"]')
  if (!menu?.id) return focused
  // A menu item disappears on selection; its invoking control remains the dialog's return target.
  return (
    [...document.querySelectorAll<HTMLElement>('[aria-haspopup="menu"][aria-controls]')].find((element) =>
      element.getAttribute("aria-controls")?.split(" ").includes(menu.id),
    ) ?? focused
  )
}

/** Runs a dialog callback so its throw is reported without stopping the caller's cleanup. */
function isolate(fn: () => void) {
  try {
    fn()
  } catch (error) {
    console.error("[dialog]", error)
  }
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()

  return (
    <Context.Provider value={ctx}>
      {props.children}
      <div data-component="dialog-stack">
        <For each={ctx.stack()}>{(item) => item.node}</For>
      </div>
    </Context.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(Context)
  const owner = getOwner()

  if (!owner) {
    throw new Error("useDialog must be used within a DialogProvider")
  }

  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider")
  }

  return {
    get active() {
      return ctx.stack().at(-1)
    },
    /**
     * id lets the caller close this dialog later rather than whichever is on top. Opening is deferred; once
     * signal aborts, the open neither mounts nor replaces anything and onClose runs as for a replaced dialog.
     */
    show(element: DialogElement, onClose?: () => void, id?: string, signal?: AbortSignal) {
      const base = ctx.stack().at(-1)?.owner ?? owner
      const opener = dialogOpener()

      return startTransition(() => {
        if (signal?.aborted) return isolate(() => onClose?.())
        ctx.show(element, base, onClose, id, opener)
      })
    },
    push(element: DialogElement, onClose?: () => void, id?: string, signal?: AbortSignal) {
      const base = ctx.stack().at(-1)?.owner ?? owner
      const opener = dialogOpener()

      return startTransition(() => {
        if (signal?.aborted) return isolate(() => onClose?.())
        ctx.push(element, base, onClose, id, opener)
      })
    },
    close(id?: string) {
      ctx.close(id)
    },
  }
}
