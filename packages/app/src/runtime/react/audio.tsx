import { sharedSource } from "./source"
import { ReactView } from "./view"
import { AudioMeterView, VoiceInputView } from "./audio.react"

export function SharedAudioMeter(props: { value: number; label: string }) {
  const source = sharedSource(() => ({ value: props.value, label: props.label }))
  return <ReactView component={AudioMeterView} props={{ source }} />
}

export function SharedVoiceInput(props: { recording: boolean; level: number; label: string; disabled: boolean; onChange: (recording: boolean) => void }) {
  const source = sharedSource(() => ({ recording: props.recording, level: props.level, label: props.label, disabled: props.disabled }))
  return <ReactView component={VoiceInputView} props={{ source, onChange: (recording) => props.onChange(recording) }} />
}
