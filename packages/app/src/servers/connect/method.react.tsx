/** @jsxImportSource react */
import { Button } from "@reddb-io/design-system/base/Button"
import type { SharedLanguage } from "@/runtime/react/language"
import type { ConnectMethod } from "./method"

export function ConnectMethodSwitch(props: {
  language: SharedLanguage
  method: ConnectMethod
  disabled?: boolean
  onChange: (method: ConnectMethod) => void
}) {
  return (
    <div
      data-component="server-connect-method"
      className="flex min-h-7 flex-wrap items-center justify-center gap-1 text-body"
    >
      <span className="text-v2-text-text-faint">
        {props.language.t(props.method === "link" ? "server.connect.password.prompt" : "server.connect.link.prompt")}
      </span>
      <Button
        variant="ghost"
        disabled={props.disabled}
        onClick={() => props.onChange(props.method === "link" ? "password" : "link")}
      >
        {props.language.t(props.method === "link" ? "server.connect.password.use" : "server.connect.link.use")}
      </Button>
    </div>
  )
}
