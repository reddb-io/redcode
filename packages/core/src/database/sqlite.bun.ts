import { Database, type SQLQueryBindings } from "bun:sqlite"
import { Context, Effect, Layer, Stream } from "effect"
import { Reactivity } from "effect/unstable/reactivity"
import { SqlClient } from "effect/unstable/sql"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import { Sqlite } from "./sqlite.js"

const TypeId = "~@opencode/core/database/SqliteBun" as const

export const supportsTuningPragmas = true

// Foreign keys default OFF and can be toggled per connection.
export const supportsForeignKeyToggle = true

interface Config extends Sqlite.ClientConfig {
  readonly filename: string
  readonly readonly?: boolean
  readonly create?: boolean
  readonly readwrite?: boolean
  readonly disableWAL?: boolean
  /** Milliseconds a statement waits for another connection's lock before SQLITE_BUSY. */
  readonly timeout?: number
}

const make = (options: Config) =>
  Effect.gen(function* () {
    const native = (yield* Sqlite.Native) as Database

    const run = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<Record<string, unknown>>, SqlError>((fiber) => {
        const statement = native.query<Record<string, unknown>, SQLQueryBindings[]>(query)
        // @ts-ignore bun-types missing safeIntegers method, fixed in https://github.com/oven-sh/bun/pull/26627
        statement.safeIntegers(Context.get(fiber.context, SqlClient.SafeIntegers))
        try {
          return Effect.succeed(statement.all(...(params as SQLQueryBindings[])) ?? [])
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: Sqlite.failure(cause, query), operation: "execute" }),
            }),
          )
        }
      })

    const runValues = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<unknown[]>, SqlError>((fiber) => {
        const statement = native.query<unknown, SQLQueryBindings[]>(query)
        // @ts-ignore bun-types missing safeIntegers method, fixed in https://github.com/oven-sh/bun/pull/26627
        statement.safeIntegers(Context.get(fiber.context, SqlClient.SafeIntegers))
        try {
          return Effect.succeed(statement.values(...(params as SQLQueryBindings[])) ?? [])
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: Sqlite.failure(cause, query), operation: "execute" }),
            }),
          )
        }
      })

    const runStream = (query: string, params: ReadonlyArray<unknown>) =>
      Stream.unwrap(
        Effect.withFiber((fiber) =>
          Effect.try({
            try: () => {
              const statement = native.query<Record<string, unknown>, SQLQueryBindings[]>(query)
              // @ts-ignore bun-types missing safeIntegers method, fixed in https://github.com/oven-sh/bun/pull/26627
              statement.safeIntegers(Context.get(fiber.context, SqlClient.SafeIntegers))
              const rows = statement.iterate(...(params as SQLQueryBindings[]))
              return Stream.fromAsyncIterable(
                {
                  async *[Symbol.asyncIterator]() {
                    yield* rows
                  },
                },
                (cause) =>
                  new SqlError({
                    reason: classifySqliteError(cause, { message: "Failed to stream statement", operation: "execute" }),
                  }),
              )
            },
            catch: (cause) =>
              new SqlError({
                reason: classifySqliteError(cause, { message: "Failed to stream statement", operation: "execute" }),
              }),
          }),
        ),
      )

    const connection = Sqlite.makeConnection(
      run,
      runValues,
      {
        export: Effect.try({
          try: () => native.serialize(),
          catch: (cause) =>
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to export database", operation: "export" }),
            }),
        }),
        loadExtension: (path: string) =>
          Effect.try({
            try: () => native.loadExtension(path),
            catch: (cause) =>
              new SqlError({
                reason: classifySqliteError(cause, { message: "Failed to load extension", operation: "loadExtension" }),
              }),
          }),
      },
      runStream,
    )

    return yield* Sqlite.makeClient(options, connection, TypeId, (acquirer) => ({
      export: Effect.flatMap(acquirer, (_) => _.export),
      loadExtension: (path: string) => Effect.flatMap(acquirer, (_) => _.loadExtension(path)),
    }))
  })

const nativeLayer = (config: Config) =>
  Layer.effect(
    Sqlite.Native,
    Effect.gen(function* () {
      const native = new Database(config.filename, {
        readonly: config.readonly,
        readwrite: config.readwrite ?? true,
        create: config.create ?? true,
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => native.close()))
      // Before anything that may need a lock, the WAL switch first of all: another process
      // creating the same file at this moment holds one, and without a timeout that is an error.
      native.run(`PRAGMA busy_timeout = ${config.timeout ?? 5000}`)
      if (config.disableWAL !== true) yield* Sqlite.enableWal(() => native.run("PRAGMA journal_mode = WAL;"))
      return native
    }),
  )

const clientLayer = (config: Config) => Layer.effect(SqlClient.SqlClient, make(config))

export const sqliteLayer = (config: Config) => {
  const native = nativeLayer(config)
  return Layer.merge(native, clientLayer(config).pipe(Layer.provide(native))).pipe(Layer.provide(Reactivity.layer))
}
