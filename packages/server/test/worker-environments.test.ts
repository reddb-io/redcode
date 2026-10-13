import { expect, test } from "bun:test"
import { WorkerEnvironment } from "@opencode/schema/worker-environment"
import { Schema } from "effect"
import { containerArguments, publicRepository } from "../src/worker-environments"
import { WorkerPool } from "../src/worker-pool"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import path from "node:path"

test("managed container policy confines writes and applies real resource and privilege limits", () => {
  const info: WorkerEnvironment.Info = { id: "tenant-a", repository: "https://example.test/repository.git", ref: "HEAD",
    image: "worker:approved", cpu: 0.5, memoryMiB: 512, directory: "/workspace/project", state: "ready", phase: "complete", createdAt: "2026-10-13T12:00:00Z" }
  const args = containerArguments(info, "owner", "/private/credential.env")
  const value = (flag: string) => args[args.indexOf(flag) + 1]
  expect(value("--user")).toBe("1000:1000")
  expect(args).toContain("--read-only")
  expect(value("--cap-drop")).toBe("ALL")
  expect(value("--security-opt")).toBe("no-new-privileges:true")
  expect(value("--pids-limit")).toBe("256")
  expect(value("--memory")).toBe("512m")
  expect(value("--memory-swap")).toBe("512m")
  expect(value("--cpus")).toBe("0.5")
  expect(args).not.toContain("--publish")
  expect(value("--network")).toBe("redcode-owner-tenant-a-network")
  expect(value("--network-alias")).toBe("worker")
  expect(args).toContain("HTTPS_PROXY=http://gateway:3128")
  expect(args.filter((arg) => arg.startsWith("type="))).toEqual([
    "type=volume,source=redcode-owner-tenant-a-workspace,target=/workspace",
    "type=volume,source=redcode-owner-tenant-a-home,target=/home/worker",
  ])
  expect(args.join(" ")).not.toContain("docker.sock")
  expect(args).not.toContain("--privileged")
  expect(args).not.toContain("--network=host")
  expect(containerArguments({ ...info, id: "tenant-b" }, "owner", "/private/credential.env").join(" ")).not.toContain("tenant-a")
})

test("public workspace bootstrap rejects embedded Git credentials and unsafe repository schemes", () => {
  for (const repository of ["file:///host/repo", "ssh://host/repo", "https://user:token@example.test/repo", "https://example.test/repo?token=secret", "https://example.test/repo#fragment"])
    expect(() => publicRepository(repository)).toThrow()
  expect(publicRepository("https://github.com/octocat/Hello-World.git")).toBe("https://github.com/octocat/Hello-World.git")
  const record = Schema.decodeUnknownSync(WorkerEnvironment.Info)({ id: "public", repository: "https://example.test/repo", ref: "HEAD", image: "approved:1",
    cpu: 1, memoryMiB: 1024, directory: "/workspace/project", state: "ready", phase: "complete", createdAt: "now", password: "secret", provider: { key: "secret" } })
  expect(JSON.stringify(record)).not.toContain("secret")
})

test("checkout reservations distinguish environment identity from the host directory", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "workers.json")
  await Bun.write(file, JSON.stringify({ workers: [
    { id: "native", url: "http://127.0.0.1:4096", passwordEnv: "native", directories: ["/workspace/project"], tags: [] },
    { id: "isolated", url: "http://127.0.0.1:4096", passwordEnv: "isolated", directories: ["/workspace/project"], tags: [], environmentID: "host", environmentProxy: true },
  ] }))
  expect((await WorkerPool.readConfig(file)).workers).toHaveLength(2)
})
