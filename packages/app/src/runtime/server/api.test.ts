import { expect, test } from "bun:test"
import { authTokenFromCredentials } from "./api"

test("authTokenFromCredentials ignores usernames in legacy saved credentials", () => {
  const credentials = { username: "legacy", password: "secret" }
  expect(authTokenFromCredentials(credentials)).toBe(btoa("opencode:secret"))
})
