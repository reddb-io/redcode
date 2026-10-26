/** @jsxImportSource react */
import { ShortcutHelp, type ShortcutGroup } from "@reddb-io/design-system/app/ShortcutHelp"

export function AgentShortcuts(props: { title: string; triggerLabel: string; groups: ShortcutGroup[] }) {
  return <ShortcutHelp title={props.title} triggerLabel={props.triggerLabel} groups={props.groups} />
}
