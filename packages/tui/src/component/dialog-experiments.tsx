import { createMemo, createSignal } from "solid-js"
import { useConfig } from "../config"
import { DialogSelect } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"

type Experiment = {
  id: string
  title: string
  description: string
}

// In-flight features anyone can opt into. Each entry is temporary: an
// experiment either graduates (delete the entry, make the behavior
// unconditional) or dies (delete the entry and the branch it gated).
export const experiments: Experiment[] = [
  {
    id: "reasoning_self_review",
    title: "Single code self-review",
    description: "Evaluation control: one bounded code review by S2 alone",
  },
  {
    id: "reasoning_code_repair",
    title: "S1 code review and repair",
    description: "Review actual code; one scoped repair with bounded Steps and existing test commands",
  },
  {
    id: "reasoning_verification",
    title: "S2 verification",
    description: "One bounded verification Step for confident S1 issues; read-only tools",
  },
  {
    id: "reasoning_tool_selection",
    title: "S1 tool selection",
    description: "Rank the partial Code Mode catalog; preserve full discovery",
  },
  {
    id: "reasoning_context_curation",
    title: "S1 context curation",
    description: "Omit dispensable old blocks with an inspectable manifest; retain original history",
  },
  {
    id: "reasoning_learning",
    title: "Learning candidates",
    description: "Propose successful corrections for review; never install memory or skills",
  },
]

export function DialogExperiments() {
  const config = useConfig()
  const theme = useTheme()
  const toast = useToast()
  const [selected, setSelected] = createSignal<Experiment>()
  const [saving, setSaving] = createSignal(false)

  const enabled = (experiment: Experiment) => config.data.experimental?.[experiment.id] === true

  const options = createMemo(() =>
    experiments.map((experiment) => ({
      title: experiment.title,
      searchText: experiment.description,
      footer: enabled(experiment) ? "on" : "off",
      value: experiment,
    })),
  )

  // All experiments are booleans, so either direction toggles.
  async function change(experiment = selected()) {
    if (saving()) return
    if (!experiment) return
    const next = !enabled(experiment)
    setSaving(true)
    await config
      .update((draft) => {
        if (!draft.experimental || typeof draft.experimental !== "object") draft.experimental = {}
        draft.experimental[experiment.id] = next
      })
      .catch(toast.error)
      .finally(() => setSaving(false))
  }

  return (
    <DialogSelect
      title="Experiments"
      options={options()}
      renderFilter={experiments.length > 0}
      onMove={(option) => setSelected(option.value)}
      onSelect={(option) => void change(option.value)}
      emptyView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.muted}>No experiments available</text>
        </box>
      }
      footerHints={experiments.length > 0 ? [{ title: "←/→", label: "change" }] : []}
      bindings={
        experiments.length > 0
          ? [
              {
                bind: "left",
                title: "Previous value",
                group: "Experiments",
                run: () => void change(),
              },
              {
                bind: "right",
                title: "Next value",
                group: "Experiments",
                run: () => void change(),
              },
            ]
          : []
      }
    />
  )
}
