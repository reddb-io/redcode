import { expect, test } from "bun:test"
import { createRedcode, createRedcodeClient, createRedcodeServer, createRedcodeTui, RedcodeClient } from "../src"

test("exports only Redcode product constructors", async () => {
  const sdk = await import("../src")

  expect(createRedcode).toBeFunction()
  expect(createRedcodeClient).toBeFunction()
  expect(createRedcodeServer).toBeFunction()
  expect(createRedcodeTui).toBeFunction()
  expect(RedcodeClient).toBeFunction()
  expect("createOpencode" in sdk).toBeFalse()
  expect("createOpencodeClient" in sdk).toBeFalse()
  expect("createOpencodeServer" in sdk).toBeFalse()
  expect("createOpencodeTui" in sdk).toBeFalse()
  expect("OpencodeClient" in sdk).toBeFalse()
})
