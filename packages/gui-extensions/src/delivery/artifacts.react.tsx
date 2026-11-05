/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Field } from "@reddb-io/design-system/base/Field"
import { Input } from "@reddb-io/design-system/base/Input"
import { Select } from "@reddb-io/design-system/base/Select"
import DOMPurify from "dompurify"
import type { DeliveryArtifacts } from "./artifacts"
import { isolatedArtifactHtml } from "./artifact-preview"

export function DeliveryArtifactsView(props: {
  view: ReturnType<DeliveryArtifacts["snapshot"]>
  actions: DeliveryArtifacts["actions"]
  copy: Record<string, string>
}) {
  const { view, actions, copy } = props
  const [title, setTitle] = useState("")
  const [source, setSource] = useState("")
  const [entry, setEntry] = useState("index.html")
  const [selected, setSelected] = useState("")
  const [revision, setRevision] = useState("")
  const [file, setFile] = useState("")
  const [content, setContent] = useState<string>()
  const [preview, setPreview] = useState<string>()
  const [failed, setFailed] = useState(false)
  const request = useRef(0)
  const artifact = view.items.find((item) => item.id === selected)
  const current = artifact?.revisions.find((item) => item.id === revision) ?? artifact?.revisions.at(-1)
  const chosen = file && current?.files[file] ? file : current?.entry
  useEffect(() => {
    const index = ++request.current
    setContent(undefined)
    setPreview(undefined)
    setFailed(false)
    if (!artifact || !current || !chosen) return
    void actions
      .content(artifact.id, current.id, chosen)
      .then(async (value) => {
        if (request.current !== index) return
        setContent(value)
        if (/\.html?$/i.test(chosen)) {
          const html = new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)))
          const safe = DOMPurify.sanitize(html, {
            WHOLE_DOCUMENT: true,
            ADD_TAGS: ["link", "style"],
            FORBID_TAGS: ["script", "meta", "base", "iframe", "frame", "object", "embed", "form"],
            FORBID_ATTR: ["srcset", "action", "formaction"],
          })
          const rendered = await isolatedArtifactHtml(chosen, safe, current.files, (name) =>
            actions.content(artifact.id, current.id, name),
          )
          if (request.current === index) setPreview(rendered)
        }
      })
      .catch(() => {
        if (request.current === index) setFailed(true)
      })
    return () => {
      request.current++
    }
  }, [artifact?.id, current?.id, chosen])
  const text = () => {
    if (content === undefined) return ""
    return new TextDecoder().decode(Uint8Array.from(atob(content), (char) => char.charCodeAt(0)))
  }
  const html = chosen?.toLowerCase().endsWith(".html") || chosen?.toLowerCase().endsWith(".htm")
  const image = chosen && /\.(png|jpe?g|gif|webp)$/i.test(chosen)
  const mime = image
    ? (
        { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as Record<
          string,
          string
        >
      )[chosen!.split(".").at(-1)!.toLowerCase()]
    : undefined
  return (
    <div className="flex min-w-0 flex-col gap-3 text-body">
      <p className="m-0 text-caption text-ink-muted">{copy.artifactDescription}</p>
      {view.unavailable && <p role="alert">{copy.artifactUnavailable}</p>}
      {view.loading && <p role="status">{copy.artifactLoading}</p>}
      {view.publishError && (
        <p role="alert">
          {copy.artifactPublishError}: {view.publishError}
        </p>
      )}
      <Field label={copy.artifactTitle}>
        {(control) => <Input {...control} value={title} onValueChange={(value) => setTitle(String(value ?? ""))} />}
      </Field>
      <Field label={copy.artifactSource}>
        {(control) => (
          <Input
            {...control}
            value={source}
            onValueChange={(value) => setSource(String(value ?? ""))}
            placeholder="reports/demo"
          />
        )}
      </Field>
      <Field label={copy.artifactEntry}>
        {(control) => <Input {...control} value={entry} onValueChange={(value) => setEntry(String(value ?? ""))} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!view.connected || view.publishing || !title.trim() || !source.trim() || !entry.trim()}
          onClick={() => actions.publish({ title, source, entry })}
        >
          {copy.artifactCreate}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!view.connected || view.publishing || !artifact || !current || !source.trim() || !entry.trim()}
          onClick={() =>
            artifact && current && actions.publish({ id: artifact.id, expectedRevision: current.id, source, entry })
          }
        >
          {copy.artifactUpdate}
        </Button>
      </div>
      {view.items.length === 0 && !view.loading && !view.unavailable && <p>{copy.artifactEmpty}</p>}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {view.items.map((item) => (
          <li key={item.id}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(item.id)
                setRevision("")
                setFile("")
              }}
            >
              {item.title}
            </Button>
          </li>
        ))}
      </ul>
      {artifact && current && (
        <section aria-label={copy.artifactPreview} className="flex min-w-0 flex-col gap-2">
          <strong>{artifact.title}</strong>
          <Field label={copy.artifactRevision}>
            {(control) => (
              <Select
                {...control}
                value={current.id}
                options={artifact.revisions.map((item, index) => ({
                  value: item.id,
                  label: `${index + 1} · ${new Date(item.created).toLocaleString()}`,
                }))}
                onValueChange={(value) => {
                  setRevision(value)
                  setFile("")
                }}
              />
            )}
          </Field>
          <Field label={copy.artifactFile}>
            {(control) => (
              <Select
                {...control}
                value={chosen}
                onValueChange={setFile}
                options={Object.keys(current.files)
                  .sort()
                  .map((name) => ({ value: name, label: name }))}
              />
            )}
          </Field>
          {failed && <p role="alert">{copy.artifactReadError}</p>}
          {content !== undefined && (
            <>
              <a href={`data:application/octet-stream;base64,${content}`} download={chosen}>
                {copy.artifactDownload}
              </a>
              {html ? (
                <>
                  <p className="text-caption text-ink-muted">{copy.artifactSandbox}</p>
                  {preview !== undefined && (
                    <iframe
                      title={copy.artifactPreview}
                      sandbox=""
                      className="min-h-64 w-full bg-white"
                      srcDoc={preview}
                    />
                  )}
                </>
              ) : image ? (
                <img alt={chosen} src={`data:${mime};base64,${content}`} />
              ) : (
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap">{text()}</pre>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
