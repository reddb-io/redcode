export * as RedDBBackend from "./reddb.js"

import type { QueryParam, QueryResult, RedDB } from "@reddb-io/client"
import { Context, Effect, Fiber, Layer, Scope, Semaphore, Stream } from "effect"
import { identity } from "effect/Function"
import { Reactivity } from "effect/unstable/reactivity"
import { SqlClient, Statement } from "effect/unstable/sql"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { SerializationError, SqlError, UnknownError } from "effect/unstable/sql/SqlError"

export interface Options {
  readonly url: string
  readonly token?: string
}

export function layer(options: Options) {
  return Layer.effect(
    SqlClient.SqlClient,
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const { connect } = await import("@reddb-io/client")
          return connect(options.url, options.token ? { auth: { token: options.token } } : undefined)
        },
        catch: (cause) => sqlError(cause, "connect"),
      }),
      (database) => Effect.promise(() => database.close()).pipe(Effect.ignore),
    ).pipe(Effect.flatMap(makeClient)),
  ).pipe(Layer.provide(Reactivity.layer))
}

function makeClient(database: RedDB) {
  return Effect.gen(function* () {
    const run = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.tryPromise({
        try: () => database.query(bindParameters(normalizeSQL(query), params.length), params.map(queryParam)).then(normalizeResult),
        catch: (cause) => sqlError(cause, "execute"),
      })
    const semaphore = yield* Semaphore.make(1)
    const connection = makeConnection((query, params) => semaphore.withPermits(1)(run(query, params)))
    const transactionConnection = makeConnection(run)
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!
      const scope = Context.getUnsafe(fiber.context, Scope.Scope)
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () => Scope.addFinalizer(scope, semaphore.release(1))),
        transactionConnection,
      )
    })

    return yield* SqlClient.make({
      acquirer: Effect.succeed(connection),
      compiler: Statement.makeCompilerSqlite(),
      transactionAcquirer,
      spanAttributes: [["db.system.name", "reddb"]],
    })
  })
}

function makeConnection(run: (query: string, params?: ReadonlyArray<unknown>) => Effect.Effect<QueryResult, SqlError>) {
  return identity<Connection>({
    execute(query, params, transformRows) {
      return run(query, params).pipe(Effect.map((result) => transformRows ? transformRows(result.rows) : result.rows))
    },
    executeRaw(query, params) {
      return run(query, params).pipe(Effect.map((result) => result.rows))
    },
    executeValues(query, params) {
      return run(query, params).pipe(Effect.map((result) => result.rows.map((row) => result.columns.map((column) => row[column]))))
    },
    executeValuesUnprepared(query, params) {
      return this.executeValues(query, params)
    },
    executeUnprepared(query, params, transformRows) {
      return this.execute(query, params, transformRows)
    },
    executeStream() {
      return Stream.die("RedDB streaming is not used by the session store")
    },
  })
}

function normalizeResult(result: QueryResult) {
  const compatible = result as QueryResult & {
    readonly records?: ReadonlyArray<{ readonly values?: Record<string, unknown> } & Record<string, unknown>>
  }
  if (Array.isArray(compatible.rows)) return compatible
  const rows = (compatible.records ?? []).map((record) => record.values ?? record)
  return {
    statement: compatible.statement ?? "",
    affected: compatible.affected ?? rows.length,
    columns: compatible.columns ?? Object.keys(rows[0] ?? {}),
    rows,
  }
}

function sqlError(cause: unknown, operation: string) {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string" ? cause.code : ""
  const reason = /serial|conflict/i.test(code)
    ? new SerializationError({ cause, operation, message: "RedDB serialization conflict" })
    : new UnknownError({ cause, operation, message: cause instanceof Error ? cause.message : "RedDB request failed" })
  return new SqlError({ reason })
}

function queryParam(value: unknown): QueryParam {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value
  if (value instanceof Uint8Array || value instanceof Date || value instanceof Float32Array || value instanceof Float64Array)
    return value
  if (Array.isArray(value) && value.every((item): item is number => typeof item === "number")) return value
  if (typeof value === "object") return Object.fromEntries(Object.entries(value))
  throw new TypeError(`Unsupported RedDB query parameter: ${typeof value}`)
}

function bindParameters(query: string, count: number) {
  if (count === 0) return query
  let index = 0
  let quote: "'" | '"' | "`" | undefined
  let doubled = false
  return query.split("").map((character, offset) => {
    if (quote) {
      if (doubled) {
        doubled = false
        return character
      }
      if (character !== quote) return character
      if (query[offset + 1] === quote) {
        doubled = true
        return character
      }
      quote = undefined
      return character
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character
      return character
    }
    if (character !== "?" || index >= count) return character
    index++
    return `$${index}`
  }).join("")
}

export function normalizeSQL(query: string) {
  const text = query
    .replace(/`((?:``|[^`])*)`/g, (_, identifier: string) => `"${identifier.replaceAll("``", "`").replaceAll('"', '""')}"`)
    .replace(/;\s*$/, "")
  if (/^\s*begin\s+deferred\s*$/i.test(text)) return "BEGIN"
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(text))
    return `${text.replace(/^(\s*)INSERT\s+OR\s+IGNORE\s+INTO\b/i, "$1INSERT INTO")} ON CONFLICT DO NOTHING`
  if (/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(text))
    return text.replace(/^(\s*CREATE\s+(?:UNIQUE\s+)?INDEX)\s+(?!IF\s+NOT\s+EXISTS\b)/i, "$1 IF NOT EXISTS ")
  if (!/^\s*CREATE\s+TABLE\b/i.test(text)) return text
  const ddl = text
    .replace(/\bDEFAULT\s+(?!\s*=)('(?:''|[^'])*')/gi, "DEFAULT = $1")
    .replace(/\bDEFAULT\s+(?!\s*=)(-?\d+(?:\.\d+)?|true|false)\b/gi, "DEFAULT = $1")
    .replace(/\s+REFERENCES\s+(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*)(?:\s*\([^)]*\))?(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:NO\s+ACTION|RESTRICT|CASCADE|SET\s+(?:NULL|DEFAULT)))*/gi, "")
    .replace(/(\bCONSTRAINT\s+"[^"]+"\s+)PRIMARY\s+KEY(?=\s*\()/gi, "$1UNIQUE")
    .replace(/^(\s*CREATE\s+TABLE)\s+(?!IF\s+NOT\s+EXISTS\b)/i, "$1 IF NOT EXISTS ")
  if (!/\bFOREIGN\s+KEY\b/i.test(ddl)) return ddl
  return ddl.split("\n").filter((line) => !/\bFOREIGN\s+KEY\b/i.test(line)).join("\n").replace(/,\s*\)/g, "\n)")
}
