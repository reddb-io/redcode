import { DatabaseSync, type SQLInputValue } from "node:sqlite"

/** Bun's small SQLite surface used by the legacy RedDB transfer commands. */
export class Database {
  readonly #database: DatabaseSync

  constructor(file: string, options?: { readonly?: boolean; create?: boolean }) {
    this.#database = new DatabaseSync(file, { readOnly: options?.readonly })
  }

  query<Row, Params extends readonly SQLInputValue[]>(query: string) {
    const statement = this.#database.prepare(query)
    return {
      all: (...params: Params) => statement.all(...params) as Row[],
      get: (...params: Params) => statement.get(...params) as Row | undefined,
    }
  }

  prepare(query: string) {
    return this.#database.prepare(query)
  }

  run(query: string) {
    this.#database.exec(query)
  }

  close() {
    this.#database.close()
  }
}
