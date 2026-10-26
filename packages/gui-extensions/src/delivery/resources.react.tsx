/** @jsxImportSource react */
import { useState } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Input } from "@reddb-io/design-system/base/Input"
import { Select } from "@reddb-io/design-system/base/Select"
import { pullRequestURL } from "./resources-model"
import type { DeliveryResources } from "./resources"

type Props = {
  view: ReturnType<DeliveryResources["snapshot"]>
  actions: DeliveryResources["actions"]
  copy: Record<string, string>
}

export function LinkedResources(props: Props) {
  const view = props.view
  const copy = props.copy
  const [url, setURL] = useState("")
  const [runID, setRunID] = useState("")
  const candidate = pullRequestURL(url)
  const run = view.runs.find((item) => item.id === runID)
  const writable = view.ready && !view.invalid && view.connected && !view.saving
  return (
    <div className="flex flex-col gap-[var(--reddb-spatial-layout-gap-md)]">
      <ResourceStatus {...props} />
      {(view.invalid || view.saveFailed) && (
        <p role="alert">{copy[view.invalid ? "resourcesInvalid" : "resourceSaveFailed"]}</p>
      )}
      <section aria-label={copy.pullRequests}>
        <h3 className="mt-0 text-eyebrow text-ink-muted">{copy.pullRequests}</h3>
        <p className="text-caption text-ink-muted">{copy.pullRequestNote}</p>
        {!view.resources.pullRequests.length && <p className="text-caption">{copy.noPullRequests}</p>}
        <ul className="m-0 list-none space-y-2 p-0">
          {view.resources.pullRequests.map((href) => (
            <li key={href} className="flex items-start gap-2 rounded-lg border border-elevation-raised-border p-2">
              <Button
                className="min-w-0 flex-1 justify-start whitespace-normal break-all text-start"
                variant="ghost"
                onClick={() => props.actions.openExternal(href)}
              >
                {href}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!writable}
                onClick={() => props.actions.change({ type: "remove-pr", url: href })}
              >
                {copy.unlink}
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (writable && candidate) props.actions.change({ type: "add-pr", url: candidate })
          }}
        >
          <label className="flex flex-col gap-1 text-caption">
            {copy.pullRequestURL}
            <Input type="url" value={url} onValueChange={setURL} disabled={!writable} />
          </label>
          {url && !candidate && (
            <p role="status" className="m-0 text-caption text-ink-muted">
              {copy.invalidPullRequest}
            </p>
          )}
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={!writable || !candidate || view.resources.pullRequests.includes(candidate)}
          >
            {copy.linkPullRequest}
          </Button>
        </form>
      </section>
      <section aria-label={copy.externalSessions}>
        <h3 className="mt-0 text-eyebrow text-ink-muted">{copy.externalSessions}</h3>
        <p className="text-caption text-ink-muted">{copy.externalNote}</p>
        {!view.resources.harnesses.length && <p className="text-caption">{copy.noExternalSessions}</p>}
        <ul className="m-0 list-none space-y-2 p-0">
          {view.resources.harnesses.map((link) => {
            const item = view.runs.find((item) => item.id === link.runID && item.driver === link.driver)
            return (
              <li key={link.runID} className="rounded-lg border border-elevation-raised-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <b className="text-body">{link.driver === "claude" ? "Claude Code" : "Codex"}</b>
                  <Badge tone={item?.state === "waiting" ? "warning" : "neutral"}>
                    {view.unavailable || !view.connected || !item
                      ? copy.externalUnavailable
                      : copy[`external.${item.state}`]}
                  </Badge>
                </div>
                <p className="my-2 break-all text-caption text-ink-muted">{item?.nativeID ?? link.runID}</p>
                {item && (
                  <p className="my-2 break-all text-caption">
                    {[item.model, item.directory].filter(Boolean).join(" · ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!item || view.unavailable || !view.connected}
                    onClick={() => props.actions.inspect(link.runID)}
                  >
                    {copy.inspectExternal}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!writable}
                    onClick={() => props.actions.change({ type: "remove-harness", ...link })}
                  >
                    {copy.unlink}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (writable && run && !view.unavailable)
              props.actions.change({ type: "add-harness", runID: run.id, driver: run.driver })
          }}
        >
          <label className="flex flex-col gap-1 text-caption">
            {copy.chooseExternal}
            <Select value={runID} onValueChange={setRunID} disabled={!writable || view.unavailable}>
              <option value="">{copy.chooseExternal}</option>
              {view.runs
                .filter((item) => !view.resources.harnesses.some((link) => link.runID === item.id))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {[
                      item.driver === "claude" ? "Claude Code" : "Codex",
                      item.nativeID ?? item.id,
                      item.directory,
                    ].join(" · ")}
                  </option>
                ))}
            </Select>
          </label>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={
              !writable || !run || view.unavailable || view.resources.harnesses.some((link) => link.runID === run.id)
            }
          >
            {copy.linkExternal}
          </Button>
        </form>
        {view.inspecting && (
          <article
            aria-label={copy.externalDetails}
            className="mt-3 rounded-lg border border-elevation-raised-border p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="m-0 text-body">{copy.externalDetails}</h4>
              <Button variant="ghost" size="sm" onClick={() => props.actions.inspect("")}>
                {copy.closeDetails}
              </Button>
            </div>
            {view.detailFailed && <p role="alert">{copy.externalUnavailable}</p>}
            {view.detail && (
              <>
                <p className="text-caption text-ink-muted">
                  {view.detail.run.capabilities.steer ? copy.steerSupported : copy.queueOnly}
                </p>
                {view.detail.requests.map((request) => (
                  <p key={request.id} className="text-caption">
                    {request.title}
                  </p>
                ))}
                <pre
                  role="log"
                  aria-label={copy.externalOutput}
                  className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-caption"
                >
                  {view.detail.events.map((event) => event.text).join("\n")}
                </pre>
              </>
            )}
          </article>
        )}
      </section>
    </div>
  )
}

export function DeliverySkills(props: Props) {
  const view = props.view
  const copy = props.copy
  const [selected, setSelected] = useState("")
  const skill = view.skills.find((item) => item.id === selected)
  return (
    <div className="flex flex-col gap-3">
      <ResourceStatus {...props} />
      <p className="m-0 text-caption text-ink-muted">{copy.skillsNote}</p>
      <label className="flex flex-col gap-1 text-caption">
        {copy.chooseSkill}
        <Select value={selected} onValueChange={setSelected} disabled={!view.connected || view.unavailable}>
          <option value="">{copy.chooseSkill}</option>
          {view.skills.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </label>
      {!view.loading && !view.skills.length && !view.unavailable && <p>{copy.noSkills}</p>}
      {skill && (
        <section aria-label={copy.skillPreview}>
          <h3 className="text-body">{skill.name}</h3>
          <p className="text-caption">{skill.description}</p>
          <p className="break-all text-caption text-ink-muted">{skill.path}</p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-elevation-raised-border p-3 text-caption">
            {skill.content}
          </pre>
          <Button
            variant="secondary"
            disabled={!view.canLoad || view.loadingSkill || view.loadedSkill === skill.id}
            onClick={() => props.actions.loadSkill(skill.id)}
          >
            {view.loadedSkill === skill.id ? copy.skillLoaded : copy.loadSkill}
          </Button>
          {!view.canLoad && view.connected && <p className="text-caption text-ink-muted">{copy.skillWaitForIdle}</p>}
        </section>
      )}
      {view.skillFailed && <p role="alert">{copy.skillLoadFailed}</p>}
      {view.loadedSkill && (
        <p role="status" className="text-caption">
          {copy.skillLoadedNote}
        </p>
      )}
    </div>
  )
}

function ResourceStatus(props: Props) {
  return (
    <>
      {props.view.loading && props.view.connected && <p role="status">{props.copy.resourceLoading}</p>}
      {(props.view.unavailable || !props.view.connected) && <p role="alert">{props.copy.resourceUnavailable}</p>}
    </>
  )
}
