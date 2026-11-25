/** @jsxImportSource react */
import { useEffect, useState } from "react"
import { Logo } from "@reddb-io/design-system/base/Logo"
import { Button } from "@reddb-io/design-system/base/Button"
import { Textarea } from "@reddb-io/design-system/base/Textarea"
import { Icon } from "@/runtime/react/icon.react"
import type { SharedLanguage } from "@/runtime/react/language"

export function ErrorScreen(props: {
  t: SharedLanguage["t"]
  locale: string
  title: string
  description: string
  details: string
  restartLabel: string
  restart: () => void
  exportLogs?: () => void
  report?: () => void
  upgrade?: () => void
  issue: () => void
  actionError?: string
  version?: string
}) {
  const [reported, setReported] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = () =>
    navigator.clipboard.writeText(props.details).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  return (
    <main lang={props.locale} className="flex h-full min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="m-auto flex w-full max-w-3xl min-w-0 flex-col items-center gap-6 text-center">
        <Logo />
        <header>
          <h1 className="text-heading text-foreground">{props.title}</h1>
          <p className="text-body text-ink-muted">{props.description}</p>
        </header>
        <div className="flex w-full min-w-0 flex-col items-end gap-1">
          <Textarea
            value={props.details}
            readOnly
            onClick={copy}
            aria-label={props.t("error.page.details.label")}
            rows={8}
            className="max-h-96 w-full font-mono text-xs"
          />
          <Button size="sm" variant="ghost" onClick={copy}>
            {props.t(copied ? "ui.textField.copied" : "ui.textField.copyToClipboard")}
          </Button>
        </div>
        <div className="flex max-w-full flex-wrap justify-center gap-3">
          <Button variant="primary" onClick={props.restart}>
            {props.restartLabel}
          </Button>
          {props.exportLogs && <Button onClick={props.exportLogs}>{props.t("error.page.action.exportLogs")}</Button>}
          {props.report && (
            <Button
              disabled={reported}
              onClick={() => {
                props.report?.()
                setReported(true)
              }}
            >
              {props.t(reported ? "error.page.action.reported" : "error.page.action.report")}
            </Button>
          )}
          {props.upgrade && <Button onClick={props.upgrade}>{props.t("error.page.action.upgrade")}</Button>}
        </div>
        {props.actionError && (
          <p role="alert" className="max-w-full wrap-break-word text-feedback-danger-foreground">
            {props.actionError}
          </p>
        )}
        <footer className="text-caption text-ink-muted">
          {props.t("error.page.report.prefix")}{" "}
          <Button variant="ghost" size="sm" onClick={props.issue}>
            {props.t("error.page.report.discord")}
            <Icon name="discord" />
          </Button>
          {props.version && <p>{props.t("error.page.version", { version: props.version })}</p>}
        </footer>
      </div>
    </main>
  )
}
