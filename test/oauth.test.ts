import { afterEach, expect, test } from "bun:test"
import { rm, writeFile } from "node:fs/promises"

import { resetEnvCache } from "../src/env"
import { oauthConfig } from "../src/oauth"

const envFile = new URL("../.env", import.meta.url)
const realIdcs = process.env.OCA_IDCS_URL
const realClient = process.env.OCA_CLIENT_ID

afterEach(async () => {
  if (realIdcs === undefined) delete process.env.OCA_IDCS_URL
  else process.env.OCA_IDCS_URL = realIdcs

  if (realClient === undefined) delete process.env.OCA_CLIENT_ID
  else process.env.OCA_CLIENT_ID = realClient

  await rm(envFile, { force: true })
  resetEnvCache()
})

test("oauth config reads values from .env", async () => {
  delete process.env.OCA_IDCS_URL
  delete process.env.OCA_CLIENT_ID
  await writeFile(
    envFile,
    ["OCA_IDCS_URL=https://idcs.env.example", "OCA_CLIENT_ID=env-client"].join("\n") + "\n",
    "utf8",
  )

  resetEnvCache()

  expect(oauthConfig()).toEqual({
    idcsUrl: "https://idcs.env.example",
    clientId: "env-client",
  })
})
