import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { Context, Effect, Layer, Stream } from "effect"
import { Reactivity } from "effect/unstable/reactivity"
import { SqlClient } from "effect/unstable/sql"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import { Sqlite } from "./sqlite.js"

const TypeId = "~@opencode/core/database/SqliteNode" as const

export const supportsTuningPragmas = true

// Foreign keys default OFF and can be toggled per connection.
export const supportsForeignKeyToggle = true

interface Config extends Sqlite.ClientConfig {
  readonly filename: string
  readonly readonly?: boolean
  readonly create?: boolean
  readonly readwrite?: boolean
  readonly disableWAL?: boolean
  readonly timeout?: number
  readonly allowExtension?: boolean
}

const make = (options: Config) =>
  Effect.gen(function* () {
    const native = (yield* Sqlite.Native) as DatabaseSync

    const run = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<Record<string, unknown>>, SqlError>((fiber) => {
        const statement = native.prepare(query)
        statement.setReadBigInts(Context.get(fiber.context, SqlClient.SafeIntegers))
        try {
          return Effect.succeed(statement.all(...(params as SQLInputValue[])) as Array<Record<string, unknown>>)
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: Sqlite.failure(cause, query), operation: "execute" }),
            }),
          )
        }
      })

    const runValues = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>((fiber) => {
        const statement = native.prepare(query)
        statement.setReadBigInts(Context.get(fiber.context, SqlClient.SafeIntegers))
        statement.setReturnArrays(true)
        try {
          return Effect.succeed(
            statement.all(...(params as SQLInputValue[])) as unknown as ReadonlyArray<ReadonlyArray<unknown>>,
          )
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
              const statement = native.prepare(query)
              statement.setReadBigInts(Context.get(fiber.context, SqlClient.SafeIntegers))
              const rows = statement.iterate(...(params as SQLInputValue[]))
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
      loadExtension: (path: string) => Effect.flatMap(acquirer, (_) => _.loadExtension(path)),
    }))
  })

const nativeLayer = (config: Config) =>
  Layer.effect(
    Sqlite.Native,
    Effect.gen(function* () {
      const native = new DatabaseSync(config.filename, {
        readOnly: config.readonly,
        // In force from open: the WAL switch below may wait on another process creating the file.
        timeout: config.timeout ?? 5000,
        allowExtension: config.allowExtension,
        enableForeignKeyConstraints: true,
        open: true,
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => native.close()))
      if (config.disableWAL !== true && config.readonly !== true)
        yield* Sqlite.enableWal(() => native.exec("PRAGMA journal_mode = WAL;"))
      return native
    }),
  )

const clientLayer = (config: Config) => Layer.effect(SqlClient.SqlClient, make(config))

export const sqliteLayer = (config: Config) => {
  const native = nativeLayer(config)
  return Layer.merge(native, clientLayer(config).pipe(Layer.provide(native))).pipe(Layer.provide(Reactivity.layer))
}
