// Real Creator session + real installer UI. Only the explicitly selected saved connection is reused, in memory.
import path from "node:path"
import os from "node:os"
import { mkdir } from "node:fs/promises"
import { Context, Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { base64Encode } from "@opencode/util/encode"
import { Model } from "@opencode/schema/model"
import { Integration } from "@opencode/schema/integration"
import { Credential } from "../src/credential"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { ServerFetch } from "../../server/src/fetch"

const output = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "redcode-creator-json-inspector"))
const source = process.argv[3]
if (!source) throw new Error("Pass the source Redcode database explicitly as the second argument")
const port = Number(process.argv[4] ?? 3198)
const directory = path.join(output, "json-inspector-workspace")
await mkdir(directory, { recursive: true })
await Bun.write(path.join(directory, "package.json"), '{"name":"creator-json-inspector-demo","private":true}')
await Bun.write(
  path.join(directory, "sample.json"),
  JSON.stringify(
    { customer: { name: "Ana", email: "ana@example.com" }, orders: [{ id: "ORD-1042", total: 149.9 }], active: true },
    null,
    2,
  ),
)
const selected = await savedConnection(source)
const global = Global.layerWith(
  Object.fromEntries(
    ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((key) => [
      key,
      path.join(output, "runtime", key),
    ]),
  ),
)
const credentialsLayer = AppNodeBuilder.build(LayerNode.group([Credential.node]), [
  Global.node.replace(global),
  Database.node.replace(Database.configured({ path: ":memory:" })),
])
const prompt = `Crie um plugin real do Redcode chamado JSON Inspector. Você está no modo Creator: use seus tools design_document, design_collaboration, edit e design_preview, mantendo todos os arquivos no work root retornado.
O projeto já declarou design.system com paths vazios, pois esta entrega é um plugin SDK sem interface visual. Não invente uma página HTML de demonstração nem instale o pacote: vou usar o instalador da interface depois.
Requisitos: contrato kind extension, target server-plugin, entry server.js, outputs package/source/instructions; package.json name creator-json-inspector, version 1.0.0, type module; server.js sem imports nem dependências.
SDK válido: export default {id:"creator.json-inspector", async setup(ctx) {await ctx.tool.transform(editor => {editor.add({name:"json_inspect",description:"Validate JSON and summarize its structure without modifying files",options:{codemode:false},input:{type:"object",properties:{json:{type:"string"}},required:["json"],additionalProperties:false},async execute(input){return {content:JSON.stringify({ok:true})}}}); /* adicione json_pointer_get também */})}}.
Implemente de verdade duas ferramentas: json_inspect analisa JSON.parse e retorna ok, tipo da raiz, contagem de objetos, arrays, chaves e valores; json_pointer_get recebe json e pointer (JSON Pointer RFC6901) e retorna valor e tipo. Suporte caminho vazio, índices de array, escapes ~0 e ~1, valide escapes e caminho inexistente. Use somente propriedades próprias e não trate primitivos como objetos. JSON inválido e caminhos inválidos devem retornar erros claros sem derrubar a ferramenta. Não execute código, não use eval, não acesse rede, filesystem ou credenciais. Evite recursão na contagem para aceitar documentos profundos.
Inclua README.md em português com os dois nomes de ferramentas, dois prompts de uso e exemplos reais. Exemplo: {"customer":{"name":"Ana","email":"ana@example.com"},"orders":[{"id":"ORD-1042","total":149.9}],"active":true}; /customer/email deve retornar ana@example.com, /orders/0/total deve retornar 149.9. Publique a revisão usando design_preview. Não diga que instalou ou testou em runtime. Ao final informe designID, revisão e root.`

await Effect.gen(function* () {
  const credentialsContext = yield* Layer.build(credentialsLayer)
  const credentials = Context.get(credentialsContext, Credential.Service)
  yield* credentials.create({
    id: selected.credential.id,
    integrationID: selected.credential.integrationID,
    label: selected.credential.label,
    value: selected.credential.value,
  })
  const handler = yield* ServerFetch.make(
    {
      app: { name: "Redcode", version: "0.87.26" },
      database: { path: path.join(output, "demo.sqlite") },
      config: {
        global: false,
        project: false,
        content: JSON.stringify({ design: { system: { paths: [], css: [] } } }),
      },
      models: { fetch: false },
      fs: { filewatcher: false },
    },
    {
      overrides: [Global.node.replace(global), Credential.node.replace(Layer.succeed(Credential.Service, credentials))],
    },
  )
  const request = async (pathname: string, method = "GET", body?: unknown) => {
    const response = await handler(
      new Request(`http://localhost${pathname}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    )
    const value = await response.json()
    if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(value)}`)
    return value
  }
  const previous = Bun.file(path.join(output, "demo.json"))
  const existing = yield* Effect.promise(async () => ((await previous.exists()) ? await previous.json() : undefined))
  const reuse = existing?.directory === directory && typeof existing?.sessionID === "string"
  const session = reuse
    ? yield* Effect.promise(() => request(`/api/session/${encodeURIComponent(existing.sessionID)}`))
    : yield* Effect.promise(() =>
        request("/api/session", "POST", {
          title: "JSON Inspector · Creator",
          agent: "creator",
          model: selected.model,
          location: { directory },
        }),
      )
  const sessionID = session.data.id as string
  const dist = path.resolve(import.meta.dir, "../../app/dist")
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port,
        idleTimeout: 120,
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/demo/setup") {
            const origin = url.origin
            const storage = {
              "opencode.global.dat:server": {
                list: [{ type: "http", displayName: "Creator lab", http: { url: origin } }],
                projects: {
                  local: [{ worktree: directory, expanded: true }],
                  [origin]: [{ worktree: directory, expanded: true }],
                },
                lastProject: { local: directory, [origin]: directory },
              },
              "opencode.window.browser.dat:tabs": [{ type: "session", server: origin, sessionId: sessionID }],
              "opencode.global.dat:language": { locale: "en" },
              "opencode-theme-id": "opencode",
              "opencode-color-scheme": "dark",
            }
            return new Response(
              `<script>for(const [key,value] of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(key,typeof value==='string'?value:JSON.stringify(value));location.href=${JSON.stringify(`/server/${base64Encode(origin)}/session/${sessionID}`)}</script>`,
              { headers: { "content-type": "text/html" } },
            )
          }
          if (url.pathname.startsWith("/api/") || url.pathname === "/global/event") return handler(request)
          const filename = path.resolve(dist, "." + decodeURIComponent(url.pathname))
          if (filename !== dist && !filename.startsWith(dist + path.sep))
            return new Response("Not found", { status: 404 })
          const file = Bun.file(filename)
          return new Response((await file.exists()) ? file : Bun.file(path.join(dist, "index.html")), {
            headers: (await file.exists()) ? undefined : { "content-type": "text/html", "cache-control": "no-store" },
          })
        },
      }),
    ),
    (server) => Effect.promise(() => Promise.resolve(server.stop(true))),
  )
  yield* Effect.promise(() =>
    Bun.write(
      path.join(output, "demo.json"),
      JSON.stringify(
        {
          url: `${server.url.origin}/demo/setup`,
          directory,
          sessionID,
          database: path.join(output, "demo.sqlite"),
          model: selected.model,
        },
        null,
        2,
      ),
    ),
  )
  console.log(`Creator lab ready: ${server.url.origin}/demo/setup`)
  if (!reuse) yield* Effect.promise(() => request(`/api/session/${sessionID}/prompt`, "POST", { text: prompt }))
  yield* Effect.never
}).pipe(Effect.scoped, Effect.runPromise)

async function savedConnection(filename: string) {
  const { Database } = await import("bun:sqlite")
  const db = new Database(filename, { readonly: true })
  try {
    const rows = db
      .query<
        { model: string },
        []
      >("select model from session_v2 where model is not null order by time_updated desc limit 30")
      .all()
    for (const item of rows) {
      const model = Schema.decodeUnknownSync(Schema.fromJsonString(Model.Ref))(item.model)
      const row =
        model.connection?.type === "credential"
          ? db
              .query<
                { id: string; integration_id: string; label: string; value: string },
                [string]
              >("select id,integration_id,label,value from credential where id = ?")
              .get(model.connection.id)
          : !model.connection
            ? db
                .query<
                  { id: string; integration_id: string; label: string; value: string },
                  [string]
                >("select id,integration_id,label,value from credential where integration_id = ? and active = 1")
                .get(model.providerID)
            : undefined
      if (!row) continue
      console.log(`Using saved ${row.label} connection with ${model.providerID}/${model.id}`)
      return {
        model: {
          ...model,
          variant: undefined,
          connection: { type: "credential" as const, id: Credential.ID.make(row.id) },
        },
        credential: new Credential.Info({
          id: Credential.ID.make(row.id),
          integrationID: Integration.ID.make(row.integration_id),
          label: row.label,
          value: Schema.decodeUnknownSync(Schema.fromJsonString(Credential.Value))(row.value),
        }),
      }
    }
    throw new Error("No explicitly selected model with an available saved credential was found")
  } finally {
    db.close()
  }
}
