import { Schema } from "effect"
import { untrack, type Accessor } from "solid-js"
import { reconcile } from "solid-js/store"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import type { Workbench } from "./panels"
import { WORKBENCH_INITIAL, WORKBENCH_RATIO, type WorkbenchState } from "./workbench-model"

const Group = Schema.Literals(["top", "bottom"])

const StoredWorkbench = Persistence.struct({
  placed: Persistence.record(Group),
  top: Persistence.optional(Schema.String),
  bottom: Persistence.optional(Schema.String),
  ratio: Schema.Finite.check(Schema.isBetween({ minimum: WORKBENCH_RATIO.min, maximum: WORKBENCH_RATIO.max })),
  maximized: Persistence.optional(Group),
  expanded: Schema.Boolean,
})

const WorkbenchStorage = Persistence.struct({
  tabs: Persistence.record(Persistence.fallback(StoredWorkbench, () => ({ ...WORKBENCH_INITIAL, placed: {} }))),
})

/** Shell tabs whose workbench is remembered; the oldest written leave first. */
const KEPT = 64

/** The workbench of the routed shell tab, persisted per shell tab like its dock and side region. */
export function createWorkbench(tab: Accessor<string | undefined>): Workbench {
  const [store, setStore] = persisted(Persist.global("workbench"), WorkbenchStorage, { tabs: {} })

  const state = () => {
    const key = tab()

    return (key && store.tabs[key]) || WORKBENCH_INITIAL
  }

  return {
    state,
    update(change: (state: WorkbenchState) => WorkbenchState) {
      const key = untrack(tab)

      if (!key) return
      const current = untrack(state)
      const next = change(current)

      if (next === current) return
      // Rewriting the entry moves it last, so the oldest written tabs are the ones pruned. `reconcile` drops keys a
      // plain store write would merge back, such as a placement the change removed.
      const kept = untrack(() => Object.entries(store.tabs)).filter(([name]) => name !== key)
      setStore(
        "tabs",
        reconcile(Object.fromEntries([...kept.slice(Math.max(0, kept.length - KEPT + 1)), [key, { ...next }]])),
      )
    },
  }
}
