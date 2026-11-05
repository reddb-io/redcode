/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { AudioMeter } from "@reddb-io/design-system/base/AudioMeter"
import { VoiceInput } from "@reddb-io/design-system/base/VoiceInput"
import type { SharedSource } from "./source"

export function AudioMeterView(props: { source: SharedSource<{ value: number; label: string }> }) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  return <AudioMeter value={view.value} label={view.label} />
}

export function VoiceInputView(props: {
  source: SharedSource<{ recording: boolean; level: number; label: string; disabled: boolean }>
  onChange: (recording: boolean) => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  return <VoiceInput type="button" recording={view.recording} value={view.level} label={view.label} title={view.label}
    disabled={view.disabled} onRecordingChange={props.onChange} />
}
