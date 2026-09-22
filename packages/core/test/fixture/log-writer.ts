import { LogFile } from "../../src/observability/log-file"

const [file, writer, limit, count] = process.argv.slice(2)
if (!file || !writer || !limit || !count) throw new Error("Missing log writer input")
for (let index = 0; index < Number(count); index++) {
  if (!(await LogFile.append(file, [`writer=${writer} entry=${index}`], Number(limit)))) process.exit(1)
}
