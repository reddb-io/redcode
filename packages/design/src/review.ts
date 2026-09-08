import type { Design } from "@reddb-io/redcode-schema/design"
import type { ReviewCopy } from "./copy"

export interface ReviewOptions {
  base: string
  sessionID: string
  copy: ReviewCopy
  request?: (url: string, init?: RequestInit) => Promise<Response>
}

/** Shared native review surface. The standalone host serializes this self-contained function. */
export function mountReview(host: HTMLElement, options: ReviewOptions) {
  const copy = { ...options.copy }
  const request = options.request ?? fetch
  const root = host.attachShadow({ mode: "open" })
  const endpoint = `${options.base.replace(/\/$/, "")}/api/session/${encodeURIComponent(options.sessionID)}/design`
  const state = {
    creating: false,
    design: undefined as Design.Info | undefined,
    revision: "",
    revisionInfo: undefined as Design.Revision | undefined,
    audits: [] as Design.Job[],
    notes: [] as { target: string; text: string }[],
    assets: [] as string[],
    snapshot: "",
    pending: undefined as Design.Feedback | undefined,
    boards: [] as { target: string; scene: unknown }[],
    board: undefined as
      | { scene: unknown; source_hash: string; baseline: unknown; text_metrics_version: number }
      | undefined,
    channel: "",
    stopped: false,
    loading: false,
  }
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
  const thumbnails = new Map<string, string>()
  const controller = new AbortController()
  const api = async <T>(route = "", method = "GET", body?: unknown): Promise<T> => {
    const response = await request(endpoint + route, {
      method,
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`${copy.failure} (${response.status})`)
    return response.json()
  }
  const element = <T extends HTMLElement>(id: string) => root.getElementById(id) as T
  const input = (id: string) => element<HTMLInputElement>(id)
  const key = () => `redcode:design:${endpoint}:${state.design?.id}:${state.revision}`
  const status = (text: string, key?: keyof ReviewCopy) => {
    element("status").textContent = text
    if (key) element("status").dataset.copy = key
    else delete element("status").dataset.copy
  }
  const text = (id: string, value: string, fallback: keyof ReviewCopy = "none") => {
    element(id).textContent = value || copy[fallback]
    if (value) delete element(id).dataset.copy
    else element(id).dataset.copy = fallback
  }
  const tasks = { tail: Promise.resolve() }
  const run = (task: () => Promise<void>) => {
    const pending = tasks.tail.then(async () => {
      if (state.stopped) return
      state.loading = true
      status(copy.busy, "busy")
      try {
        await task()
      } catch (error) {
        if (!state.stopped) status(error instanceof Error ? error.message : copy.failure)
      } finally {
        state.loading = false
      }
    })
    tasks.tail = pending
    return pending
  }
  root.innerHTML = `<style>
    :host{container-type:inline-size;display:block;height:100%;min-height:360px;color:var(--text-base,#242721);background:var(--background-base,#fafaf7);font:14px/1.5 system-ui,sans-serif;color-scheme:light dark}
    *{box-sizing:border-box}button,input,select,textarea{font:inherit;color:inherit;background:var(--background-base,#fafaf7);border:1px solid #8886;border-radius:6px;padding:7px 10px}button{cursor:pointer}button:hover{background:#8882}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #367965;outline-offset:2px}button:disabled{opacity:.5;cursor:default}
    header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px;border-bottom:1px solid #8884}h1{font-size:16px;margin:0;margin-right:auto}h2{font-size:14px;margin:0 0 8px}label{display:grid;gap:4px;margin-bottom:10px}textarea{min-height:85px;resize:vertical;width:100%}input:not([type=checkbox]),select{max-width:100%;width:100%}input[type=checkbox]{margin-right:6px}label.check{display:flex;align-items:center}main{height:calc(100% - 105px);display:grid;grid-template-columns:minmax(0,1fr) 300px}.canvas{background:#8882;overflow:auto;padding:16px;min-height:300px}iframe{display:block;background:white;border:0;min-height:100%;height:800px;margin:auto;width:100%;box-shadow:0 4px 24px #0001}aside{padding:16px;overflow:auto;border-left:1px solid #8884}details{border-bottom:1px solid #8884;padding:12px 0}summary{cursor:pointer;font-weight:600}form.intake{max-width:580px;margin:30px auto;padding:24px}form.intake h2{font-size:24px;margin-bottom:24px}.row{display:flex;gap:8px;align-items:center}.row>*{flex:1}.note{padding:8px 0;border-bottom:1px solid #8883;overflow-wrap:anywhere}.note button{float:right;padding:2px 7px}.muted{font-size:12px;opacity:.7}#status{min-height:30px;padding:6px 12px;border-top:1px solid #8884}#studio{height:calc(100% - 90px)}#studio main{height:calc(100% - 60px)}#board-frame{min-height:0}#intake[hidden],#studio[hidden]{display:none}.asset{display:flex;gap:8px;align-items:center;padding:6px 0}.asset img{width:40px;height:40px;object-fit:contain}.primary{background:#285b49;color:white}.primary:hover{background:#367965}#target{overflow-wrap:anywhere}#jobs .note{display:grid;gap:5px}#newer{color:#367965}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}#source-files{font-size:12px}small{display:block}#width{width:auto}
    @container(max-width:720px){main{display:flex;flex-direction:column;height:auto!important}.canvas{height:55vh}aside{border-left:0;border-top:1px solid #8884}iframe{height:100%}#studio{overflow:auto}}
    @media(max-width:720px){main{display:flex;flex-direction:column;height:auto}.canvas{height:60vh}aside{border-left:0;border-top:1px solid #8884}iframe{height:100%}:host{overflow:auto}header{position:sticky;top:0;background:var(--background-base,#fafaf7);z-index:2}}
    </style><header><h1><span data-copy="title">${copy.title}</span></h1><select id="designs" aria-label="${copy.alternatives}" data-copy-aria-label="alternatives"></select><button id="new"><span data-copy="create">${copy.create}</span></button><button id="refresh"><span data-copy="refresh">${copy.refresh}</span></button></header>
    <section id="intake"><form class="intake" id="create"><h2><span data-copy="create">${copy.create}</span></h2><label><span data-copy="name">${copy.name}</span><input id="name" required></label><div class="row"><label><span data-copy="journey">${copy.journey}</span><select id="journey"><option value="new" data-copy="new">${copy.new}</option><option value="existing" data-copy="existing">${copy.existing}</option></select></label><label><span data-copy="engine">${copy.engine}</span><select id="engine"><option value="html">HTML</option><option value="react">React</option><option value="solid">Solid</option></select></label></div><label><span data-copy="application">${copy.application}</span><input id="application" value="."></label><label><span data-copy="objective">${copy.objective}</span><textarea id="objective" required></textarea></label><label><span data-copy="audience">${copy.audience}</span><input id="audience"></label><label><span data-copy="constraints">${copy.constraints}</span><textarea id="constraints"></textarea></label><label><span data-copy="references">${copy.references}</span><textarea id="references"></textarea></label><button class="primary"><span data-copy="create">${copy.create}</span></button></form></section>
    <section id="studio" hidden><header><select id="revisions" aria-label="${copy.history}" data-copy-aria-label="history"></select><button id="newer" hidden><span data-copy="latest">${copy.latest}</span></button><select id="width" aria-label="${copy.width}" data-copy-aria-label="width"><option value="100%" data-copy="full">${copy.full}</option><option>390</option><option>768</option><option>1440</option></select><button id="restore"><span data-copy="restore">${copy.restore}</span></button><button id="approve" class="primary"><span data-copy="approve">${copy.approve}</span></button><button id="reopen" hidden><span data-copy="reopen">${copy.reopen}</span></button></header><main><div class="canvas"><iframe id="preview" title="${copy.review}" data-copy-title="review" sandbox="allow-scripts allow-forms" allow=""></iframe></div><aside>
    <details><summary><span data-copy="findings">${copy.findings}</span></summary><div id="findings"></div></details><h2><span data-copy="notes">${copy.notes}</span></h2><label class="check"><input id="annotate" type="checkbox"><span data-copy="annotate">${copy.annotate}</span></label><p class="muted"><span data-copy="inspect">${copy.inspect}</span></p><small id="target"></small><label><span data-copy="diagram">${copy.diagram}</span><textarea id="selection"></textarea></label><button type="button" id="whiteboard"><span data-copy="whiteboard">${copy.whiteboard}</span></button><label><span data-copy="notes">${copy.notes}</span><textarea id="note"></textarea></label><button id="add"><span data-copy="add">${copy.add}</span></button><div id="notes"></div><label><span data-copy="attachment">${copy.attachment}</span><input id="attachment" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"></label><small id="draft"><span data-copy="draft">${copy.draft}</span></small><label class="check"><input type="checkbox" id="queue"><span data-copy="queue">${copy.queue}</span></label><label class="check"><input type="checkbox" id="end"><span data-copy="end">${copy.end}</span></label><button id="send" class="primary"><span data-copy="send">${copy.send}</span></button>
    <details><summary><span data-copy="system">${copy.system}</span></summary><div id="source-files"></div><button id="refresh-system"><span data-copy="refreshSystem">${copy.refreshSystem}</span></button></details><details><summary><span data-copy="decisions">${copy.decisions}</span></summary><div id="decisions"></div><h2><span data-copy="questions">${copy.questions}</span></h2><div id="questions"></div><h2><span data-copy="scenarios">${copy.scenarios}</span></h2><div id="scenarios"></div></details>
    <details><summary><span data-copy="tweaks">${copy.tweaks}</span></summary><label><span data-copy="token">${copy.token}</span><input id="token" value="--accent"></label><label><span data-copy="value">${copy.value}</span><input id="value" value="#285b49"></label><button id="apply"><span data-copy="apply">${copy.apply}</span></button><button id="reset"><span data-copy="reset">${copy.reset}</span></button></details>
    <details><summary><span data-copy="assets">${copy.assets}</span></summary><div id="assets"></div></details><details open><summary><span data-copy="export">${copy.export}</span></summary><button id="html"><span data-copy="html">${copy.html}</span></button><button id="audit"><span data-copy="audit">${copy.audit}</span></button><label><span data-copy="implementation">${copy.implementation}</span><input id="implementation" value="dist"></label><button id="compare"><span data-copy="compare">${copy.compare}</span></button><label><span data-copy="source">${copy.source}</span><select id="svg"></select></label><div class="row"><label><span data-copy="duration">${copy.duration}</span><input id="duration" type="number" min="0.1" max="10" step="0.1" value="3"></label><label><span data-copy="fps">${copy.fps}</span><input id="fps" type="number" min="1" max="25" value="20"></label></div><label><span data-copy="size">${copy.size}</span><input id="size" type="number" min="16" max="1024" value="512"></label><label class="check"><input type="checkbox" id="transparent"><span data-copy="transparent">${copy.transparent}</span></label><button id="gif"><span data-copy="gif">${copy.gif}</span></button></details><details open><summary><span data-copy="jobs">${copy.jobs}</span></summary><div id="jobs"></div></details>
    </aside></main></section><dialog id="board-dialog" style="width:95vw;height:90vh;max-width:1400px"><button id="board-close"><span data-copy="close">${copy.close}</span></button><iframe id="board-frame" title="${copy.whiteboard}" data-copy-title="whiteboard" sandbox="allow-scripts" style="height:calc(100% - 50px);width:100%"></iframe></dialog><div id="status" role="status" aria-live="polite"></div>`

  const save = () => {
    if (!state.design) return
    try {
      localStorage.setItem(
        key(),
        JSON.stringify({
          notes: state.notes,
          assets: state.assets,
          snapshot: state.snapshot,
          text: input("note").value,
          pending: state.pending,
          boards: state.boards,
          board: state.board,
        }),
      )
    } catch {
      status(copy.failure, "failure")
    }
  }
  const drawNotes = () => {
    element("notes").replaceChildren(
      ...state.notes.map((note, index) => {
        const row = document.createElement("div")
        row.className = "note"
        row.textContent = `${note.target}: ${note.text}`
        const button = document.createElement("button")
        button.dataset.copy = "remove"
        button.textContent = copy.remove
        button.onclick = () => {
          if (state.pending) return
          state.notes.splice(index, 1)
          save()
          drawNotes()
        }
        row.append(button)
        return row
      }),
    )
    element<HTMLButtonElement>("send").textContent = state.pending ? copy.retry : copy.send
    element("send").dataset.copy = state.pending ? "retry" : "send"
    input("note").disabled = !!state.pending
  }
  const restoreDraft = () => {
    state.notes = []
    state.assets = []
    state.snapshot = ""
    state.pending = undefined
    state.boards = []
    state.board = undefined
    input("note").value = ""
    try {
      const stored = JSON.parse(localStorage.getItem(key()) ?? "null")
      if (stored) {
        state.notes = stored.notes ?? []
        state.assets = stored.assets ?? []
        state.snapshot = stored.snapshot ?? ""
        state.pending = stored.pending
        state.boards = stored.boards ?? []
        state.board = stored.board
        input("note").value = stored.text ?? ""
      }
    } catch {
      status(copy.failure, "failure")
    }
    drawNotes()
  }
  const drawSources = (revision?: Design.Revision) => {
    state.revisionInfo = revision
    text(
      "source-files",
      revision?.document.sources
        .map((item) => {
          const current = state.design?.sources.find((source) => source.file === item.file)
          return `${item.file} · ${new Date(item.observed).toLocaleString()} · ${item.hash.slice(0, 8)} · ${current?.hash === item.hash ? copy.sourceCurrent : copy.sourceChanged}`
        })
        .join("\n") ?? "",
    )
  }
  const drawEvidence = () => {
    const summary = root.querySelector<HTMLElement>("[data-review-evidence]")
    if (!summary) return
    summary.textContent = state.audits.length
      ? `${copy.evidence}: ${state.audits.map((job) => `${job.audit!.scenarios.length} · ${copy.findings}: ${job.audit!.findings.length}`).join("; ")}`
      : copy.noAudit
  }
  const chooseRevision = async (revisionID: string) => {
    if (state.revision) save()
    state.revision = revisionID
    restoreDraft()
    const revision = await api<Design.Revision[]>(`/${state.design!.id}/revision`).then((items) =>
      items.find((item) => item.id === revisionID),
    )
    if (!revision) return
    const response = await request(`${endpoint}/${state.design!.id}/revision/${revisionID}/preview`, {
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(copy.failure)
    element<HTMLIFrameElement>("preview").srcdoc = await response.text()
    input("revisions").value = revisionID
    element("newer").hidden = state.design?.revision === revisionID
    text("decisions", revision.document.decisions.map((item) => item.text).join("\n"))
    text("questions", revision.document.questions.join("\n"))
    text(
      "scenarios",
      revision.document.scenarios
        .map((item) => `${item.name}: ${item.state}${item.notApplicable ? ` (${item.notApplicable})` : ""}`)
        .join("\n"),
    )
    drawSources(revision)
  }
  const refresh = async (designID = state.design?.id) => {
    const documents = await api<Design.Info[]>()
    element("designs").innerHTML = documents
      .map((item) => `<option value="${escape(item.id)}">${escape(item.name)}</option>`)
      .join("")
    const current = documents.find((item) => item.id === designID) ?? documents.at(-1)
    if (!current) return
    const changed = state.design?.id !== current.id
    if (changed) {
      save()
      state.revision = ""
    }
    state.design = current
    input("designs").value = current.id
    element("intake").hidden = true
    element("studio").hidden = false
    element("approve").hidden = current.ended
    element("reopen").hidden = !current.ended
    element<HTMLButtonElement>("send").disabled = current.ended && !state.pending
    const revisions = await api<Design.Revision[]>(`/${current.id}/revision`)
    element("revisions").innerHTML = revisions
      .map(
        (revision) =>
          `<option value="${escape(revision.id)}">${escape(revision.name)} · ${escape(revision.id.slice(-8))}</option>`,
      )
      .join("")
    if (current.revision && (changed || !state.revision)) await chooseRevision(current.revision)
    input("revisions").value = state.revision
    element("newer").hidden = current.revision === state.revision
    drawSources(revisions.find((revision) => revision.id === state.revision))
    const assets = await api<Design.Asset[]>(`/${current.id}/asset`)
    for (const [id, url] of thumbnails) {
      if (assets.some((asset) => asset.id === id)) continue
      URL.revokeObjectURL(url)
      thumbnails.delete(id)
    }
    await Promise.all(
      assets.map(async (asset) => {
        if (thumbnails.has(asset.id)) return
        const response = await request(`${endpoint}/${current.id}/asset/${asset.id}/file`, {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(copy.failure)
        const blob = await response.blob()
        if (!state.stopped) thumbnails.set(asset.id, URL.createObjectURL(blob))
      }),
    )
    element("assets").innerHTML =
      assets
        .map(
          (asset) =>
            `<div class="asset"><img alt="" src="${thumbnails.get(asset.id) ?? ""}"><span>${escape(asset.name)}<small>${escape(asset.source)}</small></span></div>`,
        )
        .join("") || copy.noAssets
    if (assets.length) delete element("assets").dataset.copy
    else element("assets").dataset.copy = "noAssets"
    const previous = input("svg").value
    element("svg").innerHTML = assets
      .filter((asset) => asset.mime === "image/svg+xml")
      .map((asset) => `<option value="${asset.id}">${escape(asset.name)}</option>`)
      .join("")
    if (assets.some((asset) => asset.id === previous)) input("svg").value = previous
    const jobs = await api<Design.Job[]>(`/${current.id}/job`)
    state.audits = jobs.filter((job) => job.input.revision === state.revision && job.audit)
    let summary = root.querySelector<HTMLElement>("[data-review-evidence]")
    if (!summary) {
      summary = document.createElement("div")
      summary.dataset.reviewEvidence = ""
      element("jobs").before(summary)
    }
    drawEvidence()
    element("jobs").replaceChildren(
      ...jobs.map((job) => {
        const row = document.createElement("div")
        row.className = "note"
        row.textContent = `${job.input.format} · ${job.status} · ${Math.round(job.progress * 100)}%${job.error ? ` · ${job.error}` : ""}`
        if (job.audit) {
          const details = document.createElement("details")
          const summary = document.createElement("summary")
          summary.dataset.copy = "findings"
          summary.dataset.copySuffix = `: ${job.audit.findings.length}`
          summary.textContent = `${copy.findings}: ${job.audit.findings.length}`
          const content = document.createElement("div")
          content.textContent = [...job.audit.scenarios, ...job.audit.findings].join("\n")
          content.style.whiteSpace = "pre-wrap"
          details.append(summary, content)
          row.append(details)
        }
        if (job.status === "queued" || job.status === "running" || job.status === "completed") {
          const button = document.createElement("button")
          button.dataset.copy = job.status !== "completed" ? "cancel" : "download"
          button.textContent = job.status !== "completed" ? copy.cancel : copy.download
          button.onclick = () =>
            void run(async () => {
              if (job.status !== "completed") {
                await api(`/${current.id}/job/${job.id}/cancel`, "POST")
                await refresh()
                return
              }
              const response = await request(`${endpoint}/${current.id}/job/${job.id}/file`, {
                signal: controller.signal,
              })
              if (!response.ok) throw new Error(copy.failure)
              const url = URL.createObjectURL(await response.blob())
              const anchor = document.createElement("a")
              anchor.href = url
              anchor.download = `${current.name}.${job.input.format === "gif" ? "gif" : "html"}`
              anchor.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            })
          row.append(button)
        }
        return row
      }),
    )
    const message = current.ended ? "closed" : current.revision ? "draft" : "waiting"
    status(copy[message], message)
  }
  const click = (id: string, action: () => Promise<void>) => {
    element(id).onclick = () => void run(action)
  }
  click("refresh", refresh)
  click("new", async () => {
    state.creating = true
    save()
    element("intake").hidden = false
    element("studio").hidden = true
  })
  element<HTMLFormElement>("create").onsubmit = (event) => {
    event.preventDefault()
    void run(async () => {
      const created = await api<Design.Info>("", "POST", {
        name: input("name").value,
        journey: input("journey").value,
        engine: input("engine").value,
        application: input("application").value,
        kind: "screen",
      })
      await api(`/${created.id}`, "PATCH", {
        brief: {
          objective: input("objective").value,
          audience: input("audience").value,
          constraints: input("constraints").value,
          references: input("references").value.split("\n").filter(Boolean),
          content: "",
        },
      })
      const revision = await api<Design.Revision>(`/${created.id}/revision`, "POST", { name: copy.create })
      await api(`/${created.id}/feedback`, "POST", {
        id: `msg_${crypto.randomUUID()}`,
        revision: revision.id,
        text: `${input("objective").value}\n${input("constraints").value}`,
        items: [],
        assets: [],
        snapshot: "",
        delivery: "steer",
        end: false,
      })
      state.creating = false
      await refresh(created.id)
    })
  }
  element("designs").onchange = () => void run(() => refresh(input("designs").value as Design.ID))
  element("revisions").onchange = () => void run(() => chooseRevision(input("revisions").value))
  element("width").onchange = () => {
    element("preview").style.width = input("width").value === "100%" ? "100%" : `${input("width").value}px`
  }
  click("newer", async () => {
    if (state.design?.revision) await chooseRevision(state.design.revision)
  })
  click("restore", async () => {
    const result = await api<Design.Revision>(`/${state.design!.id}/restore`, "POST", { revision: state.revision })
    await refresh()
    await chooseRevision(result.id)
  })
  click("approve", async () => {
    if (!confirm(copy.confirm)) return
    await api(`/${state.design!.id}/approve`, "POST", { revision: state.revision })
    await refresh()
  })
  click("reopen", async () => {
    await api(`/${state.design!.id}/reopen`, "POST")
    await refresh()
  })
  click("refresh-system", async () => {
    await api(`/${state.design!.id}/refresh`, "POST")
    await refresh()
  })
  input("note").oninput = save
  click("add", async () => {
    if (state.pending || !input("note").value.trim()) return
    state.notes.push({
      target: element("target").textContent || "page",
      text: [input("note").value, input("selection").value].filter(Boolean).join("\n"),
    })
    input("note").value = ""
    save()
    drawNotes()
  })
  click("send", async () => {
    if (!state.revision || (!state.pending && !state.notes.length && !input("note").value.trim())) return
    state.pending ??= {
      id: `msg_${crypto.randomUUID()}` as Design.Feedback["id"],
      revision: state.revision,
      text: input("note").value.trim() || state.notes.map((note) => note.text).join("\n"),
      items: [...state.notes],
      assets: [...state.assets],
      snapshot: state.snapshot,
      whiteboards: [...state.boards],
      delivery: input("queue").checked ? "queue" : "steer",
      end: input("end").checked,
    }
    save()
    drawNotes()
    await api(`/${state.design!.id}/feedback`, "POST", state.pending)
    localStorage.removeItem(key())
    restoreDraft()
    status(copy.received, "received")
  })
  input("attachment").onchange = () =>
    void run(async () => {
      const file = input("attachment").files?.[0]
      if (!file || state.pending) return
      if (file.size > 10 * 1024 * 1024) throw new Error(copy.failure)
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(",")[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const asset = await api<Design.Asset>(`/${state.design!.id}/asset`, "POST", {
        name: file.name,
        mime: file.type || (file.name.endsWith(".svg") ? "image/svg+xml" : ""),
        data,
        source: "user",
      })
      state.assets.push(asset.id)
      save()
      await refresh()
    })
  const publishTweaks = async (tweaks: Design.Info["tweaks"]) => {
    await api(`/${state.design!.id}`, "PATCH", { tweaks })
    const revision = await api<Design.Revision>(`/${state.design!.id}/revision`, "POST", { name: copy.tweaks })
    await refresh()
    await chooseRevision(revision.id)
  }
  click("apply", () => publishTweaks({ ...state.design!.tweaks, [input("token").value]: input("value").value }))
  click("reset", () => publishTweaks({}))
  for (const format of ["html", "audit", "gif", "compare"] as const)
    click(format, async () => {
      if (!state.revision) return
      await api(`/${state.design!.id}/job`, "POST", {
        revision: format === "compare" ? state.design!.approvedRevision : state.revision,
        format,
        ...(format === "compare" ? { implementation: input("implementation").value } : {}),
        ...(format === "gif"
          ? {
              asset: input("svg").value,
              duration: Number(input("duration").value),
              fps: Number(input("fps").value),
              size: Number(input("size").value),
              transparent: input("transparent").checked,
            }
          : {}),
      })
      await refresh()
    })
  element<HTMLIFrameElement>("preview").onload = () =>
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage(
      { type: "design:annotate", enabled: input("annotate").checked },
      "*",
    )
  element("annotate").onchange = () =>
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage(
      { type: "design:annotate", enabled: input("annotate").checked },
      "*",
    )
  click("whiteboard", async () => {
    const response = await request(`${endpoint}/whiteboard`, { signal: controller.signal })
    if (!response.ok) throw new Error(copy.failure)
    state.channel = crypto.randomUUID()
    element<HTMLDialogElement>("board-dialog").showModal()
    element<HTMLIFrameElement>("board-frame").srcdoc = await response.text()
  })
  click("board-close", async () => {
    element<HTMLDialogElement>("board-dialog").close()
    save()
  })
  input("value").oninput = () =>
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage(
      { type: "design:tweak", key: input("token").value, value: input("value").value },
      "*",
    )
  const message = (event: MessageEvent) => {
    if (event.source === element<HTMLIFrameElement>("board-frame").contentWindow) {
      const data = event.data
      const reply = (value: object) =>
        element<HTMLIFrameElement>("board-frame").contentWindow?.postMessage(
          { ...value, channelId: state.channel },
          "*",
        )
      if (data?.type === "redcode-whiteboard:ready") {
        reply({
          type: "redcode-whiteboard:init",
          source: input("selection").value,
          sourceHash: input("selection").value,
          diagramIndex: 0,
          diagramId: element("target").textContent || "diagram",
          mode: "overlay",
          theme: "light",
          saved: state.board,
        })
        return
      }
      if (data?.channelId !== state.channel) return
      if (data.type === "redcode-whiteboard:save") {
        state.board = {
          scene: data.scene,
          source_hash: data.sourceHash,
          baseline: data.baseline,
          text_metrics_version: data.textMetricsVersion,
        }
        save()
        reply({ type: "redcode-whiteboard:saveResult", ok: true, flushId: data.flushId })
        return
      }
      if (data.type === "redcode-whiteboard:queueFeedback") {
        void run(async () => {
          try {
            if (state.pending) throw new Error(copy.failure)
            if (typeof data.pngDataUrl === "string" && data.pngDataUrl.startsWith("data:image/png;base64,")) {
              const asset = await api<Design.Asset>(`/${state.design!.id}/asset`, "POST", {
                name: "whiteboard.png",
                mime: "image/png",
                data: data.pngDataUrl.split(",")[1],
                source: "whiteboard",
              })
              state.assets.push(asset.id)
            }
            const target = element("target").textContent || "diagram"
            state.boards.push({ target, scene: { type: "excalidraw", version: 2, source: "redcode", ...data.scene } })
            state.notes.push({
              target,
              text:
                [String(data.note || ""), ...(Array.isArray(data.summaryLines) ? data.summaryLines.map(String) : [])]
                  .filter(Boolean)
                  .join("\n") || copy.whiteboard,
            })
            save()
            drawNotes()
            reply({ type: "redcode-whiteboard:queueResult", ok: true })
            element<HTMLDialogElement>("board-dialog").close()
          } catch (error) {
            reply({
              type: "redcode-whiteboard:queueResult",
              ok: false,
              error: error instanceof Error ? error.message : copy.failure,
            })
            throw error
          }
        })
      }
      return
    }
    if (
      event.source === element<HTMLIFrameElement>("preview").contentWindow &&
      event.data?.type === "design:layout" &&
      Array.isArray(event.data.findings)
    ) {
      text(
        "findings",
        event.data.findings
          .slice(0, 30)
          .filter(
            (item: unknown): item is { target: string; text: string } =>
              !!item &&
              typeof item === "object" &&
              "text" in item &&
              typeof item.text === "string" &&
              "target" in item &&
              typeof item.target === "string",
          )
          .map((item: { target: string; text: string }) => `${item.target}: ${item.text}`)
          .join("\n"),
      )
      return
    }
    if (event.source !== element<HTMLIFrameElement>("preview").contentWindow || event.data?.type !== "design:selection")
      return
    if (typeof event.data.target !== "string" || typeof event.data.text !== "string") return
    element("target").textContent = event.data.target.slice(0, 1000)
    input("selection").value = event.data.text.slice(0, 12000)
    state.snapshot = typeof event.data.snapshot === "string" ? event.data.snapshot.slice(0, 30000) : ""
    save()
  }
  window.addEventListener("message", message)
  const timer = setInterval(() => {
    if (!state.loading && !state.creating && !document.hidden) void run(refresh)
  }, 5000)
  void run(refresh)
  const dispose = () => {
    save()
    state.stopped = true
    controller.abort()
    thumbnails.forEach((url) => URL.revokeObjectURL(url))
    thumbnails.clear()
    clearInterval(timer)
    window.removeEventListener("message", message)
    root.replaceChildren()
  }
  return Object.assign(dispose, {
    updateCopy(next: ReviewCopy) {
      if (state.stopped) return
      Object.assign(copy, next)
      root.querySelectorAll<HTMLElement>("[data-copy]").forEach((node) => {
        node.textContent = copy[node.dataset.copy as keyof ReviewCopy] + (node.dataset.copySuffix ?? "")
      })
      for (const attribute of ["aria-label", "title"]) {
        root.querySelectorAll<HTMLElement>(`[data-copy-${attribute}]`).forEach((node) => {
          node.setAttribute(attribute, copy[node.getAttribute(`data-copy-${attribute}`) as keyof ReviewCopy])
        })
      }
      drawSources(state.revisionInfo)
      drawEvidence()
    },
  })
}
